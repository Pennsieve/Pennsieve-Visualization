import { describe, it, expect, vi, afterEach } from 'vitest'
import {
    hexToRgbA,
    sortAnnotations,
    getLayer,
    annIndexOf,
    validateAnnotation,
    getAnnotationEnd,
    isAnnotationInRange,
    getVisibleAnnotations,
    canvasScaler,
    getAnnotationDisplayName
} from './annotationUtils'
import type { Annotation, AnnotationLayer } from './annotationUtils'

const ann = (start: number, duration: number, extra: Partial<Annotation> = {}): Annotation =>
    ({ start, duration, ...extra })

const layer = (id: number | string, extra: Partial<AnnotationLayer> = {}): AnnotationLayer =>
    ({ id, annotations: [], ...extra })

/** Annotations sorted by start, one per value, all with the same duration. */
const byStart = (values: number[]): Annotation[] =>
    values.map((start, index) => ann(start, 100, { id: index }))

/** Annotations built from `[start, duration]` pairs, so end times are explicit. */
const byPair = (pairs: [number, number][]): Annotation[] =>
    pairs.map(([start, duration], index) => ann(start, duration, { id: index }))

afterEach(() => {
    vi.restoreAllMocks()
})

describe('hexToRgbA', () => {
    it('converts a six digit hex color to rgba with the given opacity', () => {
        expect(hexToRgbA('#ff8800', 0.5)).toBe('rgba(255,136,0,0.5)')
    })

    it('expands a three digit hex color to the same channels as its six digit form', () => {
        expect(hexToRgbA('#f80', 1)).toBe(hexToRgbA('#ff8800', 1))
    })

    it('is case insensitive for hex digits', () => {
        expect(hexToRgbA('#ABC', 0.15)).toBe('rgba(170,187,204,0.15)')
        expect(hexToRgbA('#abc', 0.15)).toBe('rgba(170,187,204,0.15)')
    })

    it('keeps a zero opacity in the output', () => {
        expect(hexToRgbA('#000000', 0)).toBe('rgba(0,0,0,0)')
    })

    it('throws for a hex string with no leading hash', () => {
        expect(() => hexToRgbA('ff8800', 1)).toThrow('Bad Hex')
    })

    it('throws for a css color name', () => {
        expect(() => hexToRgbA('red', 1)).toThrow('Bad Hex')
    })

    it('throws for a hex string that is neither three nor six digits', () => {
        expect(() => hexToRgbA('#ffff', 1)).toThrow('Bad Hex')
        expect(() => hexToRgbA('#ff', 1)).toThrow('Bad Hex')
        expect(() => hexToRgbA('#ff88001', 1)).toThrow('Bad Hex')
    })
})

describe('sortAnnotations', () => {
    it('orders annotations by ascending start time in place', () => {
        const annotations = byStart([30, 10, 20])
        const original = annotations

        sortAnnotations(annotations)

        expect(annotations).toBe(original)
        expect(annotations.map(a => a.start)).toEqual([10, 20, 30])
    })

    it('keeps the original order of annotations with equal start times', () => {
        const annotations = [
            ann(5, 1, { id: 'b' }),
            ann(5, 1, { id: 'a' }),
            ann(1, 1, { id: 'c' })
        ]

        sortAnnotations(annotations)

        expect(annotations.map(a => a.id)).toEqual(['c', 'b', 'a'])
    })

    it('returns nothing so callers must read the mutated array', () => {
        expect(sortAnnotations(byStart([1, 2]))).toBeUndefined()
    })

    it('accepts an empty array', () => {
        const annotations: Annotation[] = []
        sortAnnotations(annotations)
        expect(annotations).toEqual([])
    })
})

describe('getLayer', () => {
    const layers = [layer(0, { name: 'zero' }), layer(3, { name: 'three' }), layer('abc')]

    it('returns the layer whose id matches the annotation layer_id', () => {
        expect(getLayer(ann(0, 1, { layer_id: 3 }), layers)).toBe(layers[1])
    })

    it('matches a string layer id', () => {
        expect(getLayer(ann(0, 1, { layer_id: 'abc' }), layers)).toBe(layers[2])
    })

    it('returns an empty object when no layer matches', () => {
        expect(getLayer(ann(0, 1, { layer_id: 99 }), layers)).toEqual({})
    })

    it('returns an empty object when there are no layers', () => {
        expect(getLayer(ann(0, 1, { layer_id: 3 }), [])).toEqual({})
    })

    it('resolves layer_id 0 to the layer with id 0', () => {
        expect(getLayer(ann(0, 1, { layer_id: 0 }), layers)).toBe(layers[0])
    })

    it('falls back to the layer with id 0 for a null annotation', () => {
        // pins current behavior; see report
        expect(getLayer(null, layers)).toBe(layers[0])
        expect(getLayer(undefined, layers)).toBe(layers[0])
    })

    it('falls back to the layer with id 0 for an annotation with no layer_id', () => {
        // pins current behavior; see report
        expect(getLayer(ann(0, 1), layers)).toBe(layers[0])
    })

    it('does not match a numeric layer_id against a string layer id', () => {
        // pins current behavior; see report
        expect(getLayer(ann(0, 1, { layer_id: 3 }), [layer('3')])).toEqual({})
    })
})

describe('annIndexOf over start times', () => {
    const annotations = byStart([10, 20, 30, 30, 40])

    it('returns the index of an exact start time match', () => {
        expect(annIndexOf(annotations, 20, true)).toBe(1)
    })

    it('returns the first index when duplicate start times exist', () => {
        expect(annIndexOf(annotations, 30, true)).toBe(2)
    })

    it('returns the last index when duplicate start times exist', () => {
        expect(annIndexOf(annotations, 30, false)).toBe(3)
    })

    it('finds the first and the last element of the array', () => {
        expect(annIndexOf(annotations, 10, true)).toBe(0)
        expect(annIndexOf(annotations, 40, false)).toBe(4)
    })

    it('returns 0 for an empty array', () => {
        expect(annIndexOf([], 42, true)).toBe(0)
        expect(annIndexOf([], 42, false)).toBe(0)
    })

    it('returns 0 for a value below every start time', () => {
        expect(annIndexOf(annotations, 5, true)).toBe(0)
        expect(annIndexOf(annotations, 5, false)).toBe(0)
    })

    it('returns an index one short of the predecessor for a value between two start times', () => {
        // pins current behavior; see report. Start 25 sits between index 1 (start 20)
        // and index 2 (start 30), and the negative-index decoding reports 0.
        expect(annIndexOf(annotations, 25, true)).toBe(0)
        expect(annIndexOf(annotations, 25, false)).toBe(0)
    })

    it('returns an index one short of the last element for a value above every start time', () => {
        // pins current behavior; see report
        expect(annIndexOf(annotations, 100, true)).toBe(3)
        expect(annIndexOf(annotations, 100, false)).toBe(3)
    })

    it('searches from startAtIndex when one is given', () => {
        expect(annIndexOf(annotations, 40, true, 3)).toBe(4)
    })

    it('can report an index below startAtIndex when the value is out of that range', () => {
        // pins current behavior; see report
        expect(annIndexOf(annotations, 5, true, 3)).toBe(1)
    })

    it('handles a single element array', () => {
        const single = byStart([10])
        expect(annIndexOf(single, 10, true)).toBe(0)
        expect(annIndexOf(single, 10, false)).toBe(0)
        expect(annIndexOf(single, 50, true)).toBe(0)
        expect(annIndexOf(single, 5, true)).toBe(0)
    })
})

describe('annIndexOf over end times', () => {
    // Ends are 50, 150 and 250.
    const annotations = byPair([[0, 50], [100, 50], [200, 50]])

    it('returns the index of an exact end time match', () => {
        expect(annIndexOf(annotations, 150, true, 0, true)).toBe(1)
        expect(annIndexOf(annotations, 150, false, 0, true)).toBe(1)
    })

    it('searches end times, not start times, when checkEnd is set', () => {
        // Start 100 is index 1; end 100 belongs to no annotation here.
        expect(annIndexOf(annotations, 50, true, 0, true)).toBe(0)
        expect(annIndexOf(annotations, 250, true, 0, true)).toBe(2)
    })

    it('returns the first index when duplicate end times exist', () => {
        // Ends are 100, 200 and 200.
        const duplicates = byPair([[0, 100], [100, 100], [150, 50]])
        expect(annIndexOf(duplicates, 200, true, 0, true)).toBe(1)
    })

    it('returns the last index when duplicate end times exist', () => {
        const duplicates = byPair([[0, 100], [100, 100], [150, 50]])
        expect(annIndexOf(duplicates, 200, false, 0, true)).toBe(2)
    })

    it('returns 0 for an empty array', () => {
        expect(annIndexOf([], 5, true, 0, true)).toBe(0)
    })

    it('returns 0 for a value below every end time', () => {
        expect(annIndexOf(annotations, 1, true, 0, true)).toBe(0)
    })

    it('returns an index one short of the predecessor for a value between two end times', () => {
        // pins current behavior; see report
        expect(annIndexOf(annotations, 120, true, 0, true)).toBe(0)
    })

    it('returns an index one short of the last element for a value above every end time', () => {
        // pins current behavior; see report
        expect(annIndexOf(annotations, 999, false, 0, true)).toBe(1)
    })
})

describe('validateAnnotation', () => {
    const complete = { id: 1, start: 0, duration: 10, label: 'seizure', layer_id: 2 }

    it('accepts an annotation carrying every required field', () => {
        expect(validateAnnotation(complete)).toBe(true)
    })

    it('accepts extra fields alongside the required ones', () => {
        expect(validateAnnotation({ ...complete, description: 'extra' })).toBe(true)
    })

    it('rejects an annotation missing any one required field', () => {
        for (const field of ['id', 'start', 'duration', 'label', 'layer_id']) {
            const partial: Record<string, unknown> = { ...complete }
            delete partial[field]
            expect(validateAnnotation(partial), `missing ${field}`).toBe(false)
        }
    })

    it('rejects an empty object', () => {
        expect(validateAnnotation({})).toBe(false)
    })

    it('accepts required fields whose values are undefined', () => {
        // pins current behavior; see report. The check is key presence only.
        const undefinedValues = {
            id: undefined,
            start: undefined,
            duration: undefined,
            label: undefined,
            layer_id: undefined
        }
        expect(validateAnnotation(undefinedValues)).toBe(true)
    })

    it('rejects fields inherited from a prototype', () => {
        const inherited = Object.create(complete) as object
        expect(validateAnnotation(inherited)).toBe(false)
    })
})

describe('getAnnotationEnd', () => {
    it('adds the duration to the start time', () => {
        expect(getAnnotationEnd(ann(1000, 250))).toBe(1250)
    })

    it('returns the start time for a zero duration annotation', () => {
        expect(getAnnotationEnd(ann(1000, 0))).toBe(1000)
    })

    it('ignores any end field already on the annotation', () => {
        expect(getAnnotationEnd(ann(1000, 250, { end: 99 }))).toBe(1250)
    })
})

describe('isAnnotationInRange', () => {
    it('accepts an annotation fully inside the range', () => {
        expect(isAnnotationInRange(ann(100, 50), 0, 1000)).toBe(true)
    })

    it('accepts an annotation that spans the whole range', () => {
        expect(isAnnotationInRange(ann(0, 1000), 100, 200)).toBe(true)
    })

    it('accepts an annotation overlapping either end of the range', () => {
        expect(isAnnotationInRange(ann(0, 150), 100, 200)).toBe(true)
        expect(isAnnotationInRange(ann(150, 500), 100, 200)).toBe(true)
    })

    it('accepts an annotation that only touches a range boundary', () => {
        expect(isAnnotationInRange(ann(200, 10), 100, 200)).toBe(true)
        expect(isAnnotationInRange(ann(50, 50), 100, 200)).toBe(true)
    })

    it('rejects an annotation entirely after the range', () => {
        expect(isAnnotationInRange(ann(201, 10), 100, 200)).toBe(false)
    })

    it('rejects an annotation entirely before the range', () => {
        expect(isAnnotationInRange(ann(0, 99), 100, 200)).toBe(false)
    })

    it('accepts a zero duration annotation at either boundary', () => {
        expect(isAnnotationInRange(ann(100, 0), 100, 200)).toBe(true)
        expect(isAnnotationInRange(ann(200, 0), 100, 200)).toBe(true)
    })
})

describe('getVisibleAnnotations', () => {
    it('keeps only the annotations overlapping the range', () => {
        const annotations = [ann(0, 10, { id: 'before' }), ann(150, 10, { id: 'inside' }), ann(500, 10, { id: 'after' })]

        expect(getVisibleAnnotations(annotations, 100, 200).map(a => a.id)).toEqual(['inside'])
    })

    it('preserves the input order', () => {
        const annotations = [ann(150, 10, { id: 'b' }), ann(120, 10, { id: 'a' })]

        expect(getVisibleAnnotations(annotations, 100, 200).map(a => a.id)).toEqual(['b', 'a'])
    })

    it('returns a new array and leaves the input untouched', () => {
        const annotations = [ann(150, 10)]

        const visible = getVisibleAnnotations(annotations, 100, 200)

        expect(visible).not.toBe(annotations)
        expect(annotations).toHaveLength(1)
    })

    it('returns an empty array when nothing overlaps', () => {
        expect(getVisibleAnnotations([ann(0, 10)], 100, 200)).toEqual([])
        expect(getVisibleAnnotations([], 100, 200)).toEqual([])
    })
})

describe('canvasScaler', () => {
    it('multiplies the size by the pixel ratio', () => {
        expect(canvasScaler(300, 2)).toBe(600)
    })

    it('adds the offset before scaling', () => {
        expect(canvasScaler(300, 2, 10)).toBe(620)
    })

    it('defaults the offset to zero', () => {
        expect(canvasScaler(300, 1.5)).toBe(canvasScaler(300, 1.5, 0))
    })

    it('accepts a negative offset', () => {
        expect(canvasScaler(300, 2, -50)).toBe(500)
    })
})

describe('getAnnotationDisplayName', () => {
    it('prefers the label', () => {
        expect(getAnnotationDisplayName(ann(0, 1, { id: 7, label: 'seizure', name: 'other' }))).toBe('seizure')
    })

    it('falls back to the name when there is no label', () => {
        expect(getAnnotationDisplayName(ann(0, 1, { id: 7, name: 'other' }))).toBe('other')
    })

    it('falls back to the name when the label is empty', () => {
        expect(getAnnotationDisplayName(ann(0, 1, { label: '', name: 'other' }))).toBe('other')
    })

    it('falls back to the id when there is neither label nor name', () => {
        expect(getAnnotationDisplayName(ann(0, 1, { id: 7 }))).toBe('Annotation 7')
    })

    it('reports an undefined id in the fallback name', () => {
        // pins current behavior; see report
        expect(getAnnotationDisplayName(ann(0, 1))).toBe('Annotation undefined')
    })
})
