// utils/annotationUtils.ts

export interface Annotation {
    id?: number | string
    start: number
    duration: number
    label?: string
    name?: string
    layer_id?: number | string
    end?: number
    description?: string
    channelIds?: string[]
    userId?: number | string
    allChannels?: boolean
    selected?: boolean
    linkedPackage?: string
    linkedPackageDTO?: LinkedPackageDTO
    layer?: AnnotationLayer
    cStart?: number | null
    cEnd?: number | null
    cY?: number
    allOffsets?: number[]
    minOffset?: number
    maxOffset?: number
    oldStart?: number
    oldDuration?: number
}

export interface AnnotationLayer {
    id: number | string
    name?: string
    description?: string
    visible?: boolean
    selected?: boolean
    annotations: Annotation[]
    color?: string
    hexColor?: string
    bkColor?: string
    selColor?: string
}

export interface LinkedPackageContent {
    fileType?: string
    id?: string
    packageId?: string
}

export interface LinkedPackageDTO {
    content?: { id?: string }
    objects?: {
        view?: { content?: LinkedPackageContent }[]
    }
}

/**
 * Convert hex color to RGBA with specified opacity
 */
export const hexToRgbA = (hex: string, opacity: number): string => {
    let c: string[] | number
    if (/^#([A-Fa-f0-9]{3}){1,2}$/.test(hex)) {
        c = hex.substring(1).split('')
        if (c.length === 3) {
            c = [c[0], c[0], c[1], c[1], c[2], c[2]]
        }
        c = ('0x' + c.join('')) as unknown as number
        return 'rgba(' + [(c >> 16) & 255, (c >> 8) & 255, c & 255].join(',') + ',' + opacity + ')'
    }
    throw new Error('Bad Hex')
}

/**
 * Sort annotations by start time
 */
export const sortAnnotations = (annotationArray: Annotation[]): void => {
    annotationArray.sort((a, b) => {
        if (a.start < b.start) return -1
        if (a.start > b.start) return 1
        return 0
    })
}

/**
 * Get the layer for a given annotation
 */
export const getLayer = (annotation: Annotation | null | undefined, viewerAnnotations: AnnotationLayer[]): Partial<AnnotationLayer> => {
    const layerId = annotation?.layer_id || 0
    return viewerAnnotations.find(l => l.id === layerId) ?? {}
}

/**
 * Binary search to find annotation index by time value
 */
export const annIndexOf = (annArray: Annotation[], val: number, first: boolean, startAtIndex = 0, checkEnd = false): number => {
    let index
    if (checkEnd) {
        index = indexOfEnd(annArray, val, startAtIndex, annArray.length - 1, first)
    } else {
        index = indexOfStart(annArray, val, startAtIndex, annArray.length - 1, first)
    }

    if (index === -1) {
        index = 0
    } else if (index < 0) {
        index = -index - 2
    }
    return index
}

/**
 * Binary search helper for annotation start times
 */
const indexOfStart = (annArray: Annotation[], val: number, min: number, max: number, firstIndex: boolean): number => {
    if (max < min) {
        let pred = max >= 0 ? max : -max - 2
        if (pred === -1) return pred

        const predVal = annArray[pred].start
        while (pred >= 0 && annArray[pred].start === predVal) {
            pred--
        }
        return -pred - 2
    }

    const mid = parseInt(((min + max) / 2) as unknown as string)

    if (annArray[mid].start > val) {
        return indexOfStart(annArray, val, min, mid - 1, firstIndex)
    } else if (annArray[mid].start < val) {
        return indexOfStart(annArray, val, mid + 1, max, firstIndex)
    } else {
        let index = mid
        if (firstIndex) {
            while (index >= 0 && annArray[index].start === val) {
                index--
            }
            index++
        } else {
            while (index < annArray.length && annArray[index].start === val) {
                index++
            }
            index--
        }
        return index
    }
}

/**
 * Binary search helper for annotation end times
 */
const indexOfEnd = (annArray: Annotation[], val: number, min: number, max: number, firstIndex: boolean): number => {
    if (max < min) {
        let pred = max >= 0 ? max : -max - 2
        if (pred === -1) return pred

        const predVal = annArray[pred].start + annArray[pred].duration
        while (pred >= 0 && (annArray[pred].start + annArray[pred].duration) === predVal) {
            pred--
        }
        return -pred - 2
    }

    const mid = parseInt(((min + max) / 2) as unknown as string)
    const midEnd = annArray[mid].start + annArray[mid].duration

    if (midEnd > val) {
        return indexOfEnd(annArray, val, min, mid - 1, firstIndex)
    } else if (midEnd < val) {
        return indexOfEnd(annArray, val, mid + 1, max, firstIndex)
    } else {
        let index = mid
        if (firstIndex) {
            while (index >= 0 && (annArray[index].start + annArray[index].duration) === val) {
                index--
            }
            index++
        } else {
            while (index < annArray.length && (annArray[index].start + annArray[index].duration) === val) {
                index++
            }
            index--
        }
        return index
    }
}

/**
 * Validate annotation data structure
 */
export const validateAnnotation = (annotation: object): boolean => {
    const required = ['id', 'start', 'duration', 'label', 'layer_id']
    return required.every(field => Object.prototype.hasOwnProperty.call(annotation, field))
}

/**
 * Calculate annotation end time
 */
export const getAnnotationEnd = (annotation: Annotation): number => {
    return annotation.start + annotation.duration
}

/**
 * Check if annotation is within a time range
 */
export const isAnnotationInRange = (annotation: Annotation, startTime: number, endTime: number): boolean => {
    const annEnd = getAnnotationEnd(annotation)
    return !(annotation.start > endTime || annEnd < startTime)
}

/**
 * Get visible annotations within a time range
 */
export const getVisibleAnnotations = (annotations: Annotation[], startTime: number, endTime: number): Annotation[] => {
    return annotations.filter(ann => isAnnotationInRange(ann, startTime, endTime))
}

/**
 * Canvas scaling utility
 */
export const canvasScaler = (size: number, pixelRatio: number, offset = 0): number => {
    return pixelRatio * (size + offset)
}

/**
 * Get annotation display name
 */
export const getAnnotationDisplayName = (annotation: Annotation): string => {
    return annotation.label || annotation.name || `Annotation ${annotation.id}`
}
