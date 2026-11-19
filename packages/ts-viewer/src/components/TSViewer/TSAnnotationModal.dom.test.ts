// The annotation dialog mounted on its own, against a store holding one annotation.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { Annotation, AnnotationLayer } from '@/utils/annotationUtils'

// The store reaches for the token provider on construction; nothing here authenticates.
vi.mock('@/composables/useToken', () => ({
    useToken: vi.fn(async () => 'a.jwt.token')
}))

const loadBundleDescription = vi.fn()
vi.mock('@/composables/useBundleAnnotations', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/composables/useBundleAnnotations')>()),
    loadBundleDescription: (...args: unknown[]) => loadBundleDescription(...args)
}))

const { default: TSAnnotationModal } = await import('./TSAnnotationModal.vue')
const { createViewerStore } = await import('@/stores/tsviewer')

const BUNDLE_LAYER = 'bundle:annotations'
const API_LAYER = 42

/** 2019-11-09 16:31:56 UTC, in microseconds. */
const START_US = Date.UTC(2019, 10, 9, 16, 31, 56) * 1000

const annotationFixture = (fields: Partial<Annotation>): Annotation => ({
    id: 'ann-1',
    layer_id: BUNDLE_LAYER,
    label: 'PAT BIOCAL EEG',
    description: 'Calibration run',
    start: START_US,
    end: START_US,
    duration: 0,
    allChannels: true,
    channelIds: [],
    ...fields
} as Annotation)

const layerFixture = (id: string | number, name: string): AnnotationLayer => ({
    id,
    name,
    visible: true,
    selected: false,
    annotations: []
} as AnnotationLayer)

let instance = 0
let wrapper: VueWrapper | null = null

const openDialog = async (annotation: Annotation) => {
    const store = createViewerStore(`annotation-modal-test-${instance++}`)
    store.setAnnotations([layerFixture(BUNDLE_LAYER, 'EDF annotations'), layerFixture(API_LAYER, 'Reviewer notes')])
    store.setActiveAnnotation(annotation)

    wrapper = mount(TSAnnotationModal, {
        props: { visible: false },
        global: { provide: { viewerStore: store } },
        attachTo: document.body
    })
    await wrapper.setProps({ visible: true })
    await flushPromises()
    return wrapper
}

const dialog = () => document.body.querySelector('.timeseries-annotation-modal') as HTMLElement

/** The value shown under a read-only field label. */
const detail = (label: string) => {
    const term = Array.from(dialog().querySelectorAll('dt')).find((dt) => dt.textContent?.trim() === label)
    return term?.nextElementSibling?.textContent?.trim()
}

const footerButton = () => dialog().querySelector('.buttons button') as HTMLButtonElement

beforeEach(() => {
    setActivePinia(createPinia())
    loadBundleDescription.mockReset()
})

afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    document.body.innerHTML = ''
})

describe('bundle annotation', () => {
    it('opens as read-only details', async () => {
        await openDialog(annotationFixture({}))

        expect(dialog().querySelector('.el-dialog__title')?.textContent).toBe('Annotation Details')
        expect(dialog().querySelector('.read-only-tag')?.textContent).toBe('Read only')
        expect(dialog().querySelector('input, textarea, .el-select, .el-switch')).toBeNull()
    })

    it('shows every field in full', async () => {
        await openDialog(annotationFixture({}))

        expect(detail('Time')).toBe('2019-11-09 16:31:56 UTC')
        expect(detail('Duration')).toBe('Single point')
        expect(detail('Layer')).toBe('EDF annotations')
        expect(detail('Type')).toBe('PAT BIOCAL EEG')
        expect(detail('Description')).toBe('Calibration run')
    })

    it('shows a range within one day with the date once', async () => {
        await openDialog(annotationFixture({ end: START_US + 4_200_000, duration: 4_200_000 }))

        expect(detail('Time')).toBe('2019-11-09 16:31:56 → 16:32:00.200 UTC')
        expect(detail('Duration')).toBe('4.2 s')
    })

    it('spells out a duration longer than a minute', async () => {
        const duration = (3600 + 2 * 60 + 5) * 1_000_000
        await openDialog(annotationFixture({ end: START_US + duration, duration }))

        expect(detail('Duration')).toBe('1 h 2 min 5 s')
    })

    it('says so when there is no description', async () => {
        await openDialog(annotationFixture({ description: '' }))

        expect(detail('Description')).toBe('No description')
    })

    it('says so when the description cannot be read', async () => {
        loadBundleDescription.mockRejectedValue(new Error('offline'))
        vi.spyOn(console, 'warn').mockImplementation(() => {})

        await openDialog(annotationFixture({ description: undefined }))

        expect(detail('Description')).toBe('Description unavailable')
    })

    it('names the channels it applies to', async () => {
        await openDialog(annotationFixture({ allChannels: false, channelIds: ['a', 'b', 'c'] }))

        expect(dialog().querySelector('.channels-selected')?.textContent?.trim()).toBe('Applies to 3 channels')
    })

    it('closes without saving', async () => {
        const modal = await openDialog(annotationFixture({}))

        expect(footerButton().textContent?.trim()).toBe('Close')
        footerButton().click()
        await flushPromises()

        expect(modal.emitted('createUpdateAnnotation')).toBeUndefined()
        expect(modal.emitted('closeWindow')).toBeTruthy()
    })
})

describe('API annotation', () => {
    it('keeps the editable form', async () => {
        const modal = await openDialog(annotationFixture({ layer_id: API_LAYER, label: 'Event' }))

        expect(dialog().querySelector('.el-dialog__title')?.textContent).toBe('Edit Annotation')
        expect(dialog().querySelector('.read-only-tag')).toBeNull()
        expect(dialog().querySelector('textarea')).not.toBeNull()
        expect(footerButton().textContent?.trim()).toBe('Update')

        footerButton().click()
        await flushPromises()

        expect(modal.emitted('createUpdateAnnotation')).toBeTruthy()
    })
})
