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
    userId?: number | string
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

/** The time an index is searched by: the annotation's start, or its end. */
const searchKey = (annotation: Annotation, checkEnd: boolean): number =>
    checkEnd ? annotation.start + annotation.duration : annotation.start

/**
 * Locates `val` among annotations ordered by start time (or by end time when
 * `checkEnd`).
 *
 * On an exact hit, returns the first matching index when `first` is set and the
 * last matching index otherwise, so a run of annotations sharing a time can be
 * walked from either end. With no exact hit, returns the last index whose time
 * is below `val`, which is the annotation immediately preceding it. Returns -1
 * when nothing precedes `val`, including for an empty array: callers must treat
 * a negative result as "no such annotation" rather than as index 0.
 *
 * `startAtIndex` bounds the search from below; the result never precedes it.
 */
export const annIndexOf = (annArray: Annotation[], val: number, first: boolean, startAtIndex = 0, checkEnd = false): number => {
    let low = Math.max(0, startAtIndex)
    let high = annArray.length - 1
    let match = -1
    let preceding = -1

    while (low <= high) {
        const mid = (low + high) >> 1
        const key = searchKey(annArray[mid], checkEnd)

        if (key === val) {
            match = mid
            // Keep going toward the end of the run the caller asked for.
            if (first) {
                high = mid - 1
            } else {
                low = mid + 1
            }
        } else if (key < val) {
            preceding = mid
            low = mid + 1
        } else {
            high = mid - 1
        }
    }

    return match >= 0 ? match : preceding
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
