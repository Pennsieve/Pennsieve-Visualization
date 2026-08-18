// @/composables/useCanvasRenderer.ts
import { ref, nextTick } from 'vue'
import type { ContinuousSegmentBlock } from './streaming/segments'
import type { ViewData, ViewDataChannel } from './useTimeSeriesData'

/** The keys of the viewer constants object this renderer reads. */
export interface RendererConstants {
    XOFFSET: number
    USEMEDIAN: boolean
}

// TODO(ts-3c): replace with the store type once stores/tsviewer converts
export interface RendererChannelView {
    id: string
    type: string
    visible: boolean
    rank: number
    rowScale: number
    rowBaseline: number | null
    sf: number
    selected: boolean
    hover: boolean
    dataSegments: number[]
}

interface RendererViewport {
    start: number
    duration: number
    cWidth: number
    cHeight: number
    pHeight: number
    rsPeriod: number
    nrVisibleChannels: number
}

export const useCanvasRenderer = () => {
    const plotCanvasRef = ref<HTMLCanvasElement | null>(null)
    const blurCanvasRef = ref<HTMLCanvasElement | null>(null)

    // Canvas scaler from original
    const cpCanvasScaler = (sz: number, pixelRatio: number, offset: number) => {
        return pixelRatio * (sz + offset)
    }

    // Initialize canvases
    const initializeCanvases = (pixelRatioValue = 1) => {
        // No longer managing pixelRatio internally
        // Just initialize the canvases with the provided pixel ratio
        return pixelRatioValue
    }

    // Render data (from original)
    const renderData = (viewData: ViewData, viewerChannels: RendererChannelView[], constants: RendererConstants, viewport: RendererViewport, globalZoomMult: number, pixelRatioValue: number, isRedraw = false) => {
        const blurCanvas = blurCanvasRef.value
        if (!blurCanvas) {
            console.warn('blurArea ref is missing, skipping renderData')
            return
        }
        const ctxb = blurCanvas.getContext('2d')
        if (!ctxb) {
            console.warn('Unable to get 2D context for blurArea, skipping renderData')
            return
        }
        ctxb.setTransform(pixelRatioValue, 0, 0, pixelRatioValue, 0, 0)
        ctxb.fillStyle = 'rgb(220,220,220)'

        const plotCanvas = plotCanvasRef.value
        if (!plotCanvas) {
            console.warn('plotArea ref is missing, skipping drawing.')
            return
        }

        const ctx = plotCanvas.getContext('2d')
        if (!ctx) {
            console.warn('Unable to get 2D context for plotArea, skipping drawing.')
            return
        }
        ctx.setTransform(pixelRatioValue, 0, 0, pixelRatioValue, 0, 0)

        // Clear canvas
        ctx.clearRect(0, 0, viewport.cWidth, viewport.cHeight)
        ctxb.clearRect(0, 0, viewport.cWidth, viewport.cHeight)

        // Update number of visible channels
        const nrVisCh = viewerChannels.reduce((accumulator, currentValue) => {
            if (currentValue.visible) {
                return accumulator + 1
            }
            return accumulator
        }, 0)

        // Compute channel views
        computeChannelViews(viewerChannels, viewport.pHeight, nrVisCh)

        ctx.save()

        for (let ch in viewData.channels) {
            if (Object.prototype.hasOwnProperty.call(viewData.channels, ch)) {
                const curChannelData = viewData.channels[ch as unknown as number]

                // Get channelview for current channel
                let curChannelView: RendererChannelView | null | undefined = null
                curChannelView = viewerChannels.find((elem) => {
                    return elem.id === curChannelData.id
                })

                if (!curChannelView || !curChannelView.visible) {
                    continue
                }

                // Render segment placeholders
                const startT = viewport.start
                const rsP = viewport.rsPeriod
                const xOffset = constants.XOFFSET
                const blurHeight = Math.min(Math.round((viewport.cHeight / viewData.channels.length) - 2), 10)

                for (let i = 0; i < curChannelView.dataSegments.length; i += 2) {

                    if (curChannelView.dataSegments[i + 1] < startT) {
                        continue
                    }
                    if (curChannelView.dataSegments[i] > (startT + viewport.duration)) {
                        break
                    }
                    let xPos1 = Math.floor((((xOffset + (curChannelView.dataSegments[i] - startT) / (rsP)))))
                    let xPos2 = Math.floor((((xOffset + (curChannelView.dataSegments[i + 1] - startT) / (rsP)))))
                    let yPos = Math.floor(curChannelView.rowBaseline! - blurHeight / 2)
                    ctxb.fillRect(xPos1, yPos, xPos2 - xPos1, blurHeight)
                }

                // Get canvas points for current channel
                getPointCoords(curChannelView, curChannelData, viewport, constants, globalZoomMult, isRedraw)

                // Check Channel-Type
                const nrBlocks = curChannelData.blocks.length
                let channelType = 'Continuous'
                if (nrBlocks) {
                    channelType = curChannelData.blocks[0].type
                }

                // Set channel style
                if (curChannelView.hover) {
                    if (curChannelView.selected) {
                        ctx.strokeStyle = 'rgba(39,96,255,0.70)'
                        ctx.fillStyle = 'rgba(39,96,255,0.70)'
                    } else {
                        ctx.strokeStyle = 'rgba(39,96,255,0.60)'
                        ctx.fillStyle = 'rgba(39,96,255,0.60)'
                    }
                } else if (curChannelView.selected) {
                    ctx.strokeStyle = 'rgb(249,162,58)'
                    ctx.fillStyle = 'rgb(249,162,58)'
                } else if (channelType === 'Neural') {
                    ctx.strokeStyle = 'rgb(249,162,58)'
                } else {
                    ctx.strokeStyle = 'black'
                    ctx.fillStyle = 'black'
                }

                const realSamplePeriod = 1000000 * (1 / curChannelView.sf)

                // Bins under 3 samples wide do not read as a band, so the channel draws ticks
                // instead of a filled envelope. The decision is made for the whole channel,
                // which keeps every block of it in one path.
                let doPolFill = true
                for (let block = 0; block < nrBlocks; block++) {
                    const curBlock = curChannelData.blocks[block]
                    if (curBlock.nrPoints > 0 && curBlock.isMinMax &&
                        (curBlock.samplePeriod / realSamplePeriod) < 3) {
                        doPolFill = false
                    }
                }

                // A block starting within `joinPx` of the previous block's end continues the
                // same trace across a page boundary. Wider separations are data gaps and stay
                // open.
                const joinsPrevious = (lastEnd: { x: number; y: number; y2: number } | null, x: number, joinPx: number) => {
                    return lastEnd !== null && x < (lastEnd.x + joinPx)
                }

                // Both passes below paint one path per channel. Two paths that abut at a
                // fractional x composite to less than full coverage, which leaves a light
                // seam down the trace at every page boundary.
                let lastBlockEnd: { x: number; y: number; y2: number } | null = null
                let hasBand = false

                ctx.beginPath()
                for (let block = 0; block < nrBlocks; block++) {
                    const curBlock = curChannelData.blocks[block]

                    if (curBlock.nrPoints === 0) {
                        continue
                    }

                    const xVec = curBlock.cData[0]
                    const yVec = curBlock.cData[1]
                    const y2Vec = curBlock.cData[2]
                    const startIndex = curBlock.renderStartIndex as number
                    const endIndex = curBlock.renderEndIndex as number

                    ctxb.clearRect(Math.floor(xVec[startIndex]), Math.floor(curChannelView.rowBaseline! - blurHeight / 2), Math.ceil(xVec[endIndex] - xVec[startIndex] + 2), blurHeight + 1)

                    const isContinuous = curBlock.type === 'Continuous' || (curBlock.type as string) === 'realtime'
                    if (isContinuous && curBlock.isMinMax) {
                        if (doPolFill) {
                            const joined = joinsPrevious(lastBlockEnd, xVec[startIndex], 3)

                            if (joined) {
                                ctx.moveTo(lastBlockEnd!.x, lastBlockEnd!.y)
                            } else {
                                ctx.moveTo(xVec[startIndex], yVec[startIndex])
                            }

                            for (let i = startIndex; i < (endIndex + 1); i++) {
                                ctx.lineTo(xVec[i], yVec[i])
                            }
                            for (let i2 = endIndex; i2 >= startIndex; i2--) {
                                ctx.lineTo(xVec[i2], y2Vec[i2])
                            }

                            if (joined) {
                                ctx.lineTo(lastBlockEnd!.x, lastBlockEnd!.y2)
                            }

                            ctx.closePath()
                        } else {
                            for (let i = startIndex; i < (endIndex + 1); i++) {
                                ctx.moveTo(xVec[i], yVec[i])
                                ctx.lineTo(xVec[i], y2Vec[i])
                            }
                        }
                        hasBand = true
                    }

                    lastBlockEnd = {
                        x: xVec[curBlock.nrPoints - 1],
                        y: yVec[curBlock.nrPoints - 1],
                        y2: y2Vec[curBlock.nrPoints - 1]
                    }
                }
                if (hasBand) {
                    if (doPolFill) {
                        ctx.fill()
                    } else {
                        ctx.stroke()
                    }
                }

                // Trace the max values as a single line. This helps with making traces clear.
                lastBlockEnd = null
                let hasTrace = false

                ctx.beginPath()
                for (let block = 0; block < nrBlocks; block++) {
                    const curBlock = curChannelData.blocks[block]

                    if (curBlock.nrPoints === 0) {
                        continue
                    }

                    const xVec = curBlock.cData[0]
                    const yVec = curBlock.cData[1]
                    const y2Vec = curBlock.cData[2]
                    const startIndex = curBlock.renderStartIndex as number
                    const endIndex = curBlock.renderEndIndex as number

                    switch (curBlock.type as string) {
                        case 'Continuous':
                        case 'realtime':
                            if (!joinsPrevious(lastBlockEnd, xVec[startIndex], curBlock.isMinMax ? 3 : 2)) {
                                ctx.moveTo(xVec[startIndex], yVec[startIndex])
                            }
                            for (let i = startIndex; i < (endIndex + 1); i++) {
                                ctx.lineTo(xVec[i], yVec[i])
                            }
                            hasTrace = true
                            break

                        case 'Neural':
                            for (let i = 0; i < curBlock.nrPoints; i++) {
                                ctx.moveTo(xVec[i], yVec[i])
                                ctx.lineTo(xVec[i], y2Vec[i])
                            }
                            hasTrace = true
                            break
                    }

                    lastBlockEnd = {
                        x: xVec[curBlock.nrPoints - 1],
                        y: yVec[curBlock.nrPoints - 1],
                        y2: y2Vec[curBlock.nrPoints - 1]
                    }
                }
                if (hasTrace) {
                    ctx.stroke()
                }
            }
        }
        ctx.restore()
    }

    // Compute channel views (from original)
    const computeChannelViews = (viewerChannels: RendererChannelView[], pHeight: number, nrVisibleChannels: number) => {
        const mapped = viewerChannels.map(function(el, i) {
            return { index: i, value: el.rank }
        })
        mapped.sort(function(a, b) {
            return +(a.value > b.value) || +(a.value === b.value) - 1
        })
        const rankedIds = mapped.map(function(el) { return el.index })

        // Need to add 20px to pHeight as pHeight is calculated as => const pHeight = computed(() => props.cHeight - 20)
        // and spacing of labels is based on cHeight
        const interChannelDist = (pHeight + 20) / nrVisibleChannels

        let curIdx = 0
        for (let i = 0; i < rankedIds.length; i++) {
            const curRow = viewerChannels[rankedIds[i]]
            if (curRow.visible) {
                curRow.rowBaseline = (0.5 * interChannelDist) + curIdx * interChannelDist
                curIdx++
            } else {
                curRow.rowBaseline = null
            }
        }
    }

    // Get point coordinates (from original)
    const getPointCoords = (channelInfo: RendererChannelView, channelData: ViewDataChannel, viewport: RendererViewport, constants: RendererConstants, globalZoomMult: number, isRedraw: boolean) => {
        let segmLength = channelData.blocks.length

        // Find mean of rendered data
        switch (channelInfo.type) {
            case 'UNIT':
                if (!isRedraw) {
                    for (let iSegm = 0; iSegm < segmLength; iSegm++) {
                        const curSeg = channelData.blocks[iSegm]
                        const curCData = curSeg.cData
                        const curData = curSeg.parsedData
                        const xOffset = constants.XOFFSET

                        const length = curSeg.parsedData[0].length
                        const cXArray = curCData[0]
                        const cYArray = curCData[1]
                        const cY2Array = curCData[2]
                        const XArray = curData[0]

                        const rowBaseLine = channelInfo.rowBaseline! | 0
                        const startT = viewport.start
                        const rsP = viewport.rsPeriod
                        const spikeHeigth = (viewport.cHeight / (2 * (viewport.nrVisibleChannels + 1))) | 0

                        for (let iPoint = 0; iPoint < length; iPoint++) {
                            cXArray[iPoint] = (((xOffset + (XArray[iPoint] - startT) / (rsP))))
                            cYArray[iPoint] = rowBaseLine - spikeHeigth
                            cY2Array[iPoint] = rowBaseLine + spikeHeigth
                        }
                    }
                }
                break

            case 'CONTINUOUS':
                let totalPointsInMean = 0

                if (!isRedraw) {
                    channelData.mean = 0
                    channelData.median = 0
                    for (let iSegm = 0; iSegm < segmLength; iSegm++) {
                        const curBlock = channelData.blocks[iSegm] as ContinuousSegmentBlock
                        if (curBlock.nrValidPoints > 0) {
                            channelData.mean = (curBlock.sumElem + (totalPointsInMean * channelData.mean)) / (totalPointsInMean + curBlock.nrValidPoints)
                            channelData.median = (curBlock.median + (totalPointsInMean * channelData.median)) / (totalPointsInMean + curBlock.nrValidPoints)
                            totalPointsInMean += curBlock.nrValidPoints
                        }
                    }
                }

                for (let iSegm = 0; iSegm < segmLength; iSegm++) {
                    const curSeg = channelData.blocks[iSegm]

                    // Find startIndex viewPort
                    let startIndex = Math.floor((viewport.start - curSeg.startTs) / curSeg.samplePeriod)
                    curSeg.renderStartIndex = ((startIndex > 0) ? startIndex : 0)

                    let endIndex = Math.floor(((viewport.start + viewport.duration) - (curSeg.startTs + curSeg.nrPoints * curSeg.samplePeriod)) / curSeg.samplePeriod)
                    curSeg.renderEndIndex = endIndex >= 0 ? (curSeg.nrPoints - 1) : (curSeg.nrPoints + endIndex)

                    const curCData = curSeg.cData
                    const curData = curSeg.parsedData
                    const curScale = globalZoomMult * channelInfo.rowScale
                    const xOffset = constants.XOFFSET

                    const length = curSeg.parsedData[0].length
                    const cXArray = curCData[0]
                    const cYArray = curCData[1]
                    const cY2Array = curCData[2]
                    const XArray = curData[0]
                    const YArray = curData[1]
                    const Y2Array = curData[2]

                    const rowBaseLine = channelInfo.rowBaseline!

                    let chDatCenterer = 0
                    if (constants.USEMEDIAN) {
                        chDatCenterer = channelData.median!
                    } else {
                        chDatCenterer = channelData.mean!
                    }

                    const rsp = viewport.rsPeriod
                    const startT = viewport.start

                    for (let iPoint = 0; iPoint < length; iPoint++) {
                        cXArray[iPoint] = (((xOffset + (XArray[iPoint] - startT) / rsp)))
                        cYArray[iPoint] = (((rowBaseLine - (YArray[iPoint] - chDatCenterer) * curScale)))

                        if (curSeg.isMinMax) {
                            if (YArray[iPoint] === Y2Array[iPoint]) {
                                cY2Array[iPoint] = cYArray[iPoint] + 1
                            } else {
                                cY2Array[iPoint] = (((rowBaseLine - (Y2Array[iPoint] - chDatCenterer) * curScale)))
                            }
                        }
                    }
                }
                break
        }
    }

    return {
        plotCanvasRef,
        blurCanvasRef,
        initializeCanvases,
        renderData,
        computeChannelViews,
        getPointCoords,
        cpCanvasScaler
    }
}