// @/composables/useChannelProcessing.ts
import { computed, reactive, ref, watch, readonly } from 'vue'
import type { Ref } from 'vue'
import type { ChannelDetail } from './streaming/channelDetails'

export interface MontageChannelPair {
    name?: string
    channels: string[]
}

/** A workspace montage definition; the store holds these in `workspaceMontages`. */
export interface WorkspaceMontage {
    name: string
    channelPairs: MontageChannelPair[]
}

/** Envelope `createVirtualChannel` builds around a base channel. */
export interface VirtualChannelContent {
    id: string
    serverId: string
    name: string
    channelType: string
    label: string
    displayName: string
    unit: string
    rate: number
    start: number
    end: number
    montageScheme: string
    isMontaged: boolean
    baseChannelId: string
}

export interface VirtualChannel {
    content: VirtualChannelContent
    properties: unknown[]
}

export const useChannelProcessing = (baseChannels: Ref<ChannelDetail[] | undefined>, viewerMontageScheme: Ref<string>, workspaceMontages: Ref<WorkspaceMontage[]>, activeViewer: Ref<{ content: { id: string } } | null | undefined>) => {    // Processing state
    const processingStats = reactive({
        totalChannels: 0,
        processedChannels: 0,
        montageChannels: 0,
        errors: 0,
        lastProcessingTime: 0
    })

    // Channel cache for performance
    const channelCache = ref(new Map<string, ChannelDetail>())
    const montageCache = ref(new Map<string, string>())

    // Computed properties
    const isViewingMontage = computed(() =>
        viewerMontageScheme.value !== 'NOT_MONTAGED'
    )

    const currentMontage = computed(() => {
        if (!isViewingMontage.value || !workspaceMontages.value) {
            return null
        }
        return workspaceMontages.value.find(m => m.name === viewerMontageScheme.value)
    })

    const montageChannelPairs = computed(() => {
        return currentMontage.value?.channelPairs || {}
    })

    // Clear caches when montage changes
    watch(viewerMontageScheme, () => {
        channelCache.value.clear()
        montageCache.value.clear()
    })

    /**
     * Extract channel ID from channel object
     */
    const getChannelId = (channel: { id?: string } | null | undefined) => {
        if (!channel) return ''
        // Use the id field (which is unique for client-side)
        return channel?.id ?? ''
    }

    /**
     * Generate display name for montaged channels
     * Falls back to simple concatenation if montage definition not found
     */
    const getDisplayName = (channel1: string, channel2: string, montageName: string | null = null) => {
        const montageToUse = montageName || viewerMontageScheme.value

        // Check cache first
        const cacheKey = `${channel1}_${channel2}_${montageToUse}`
        if (montageCache.value.has(cacheKey)) {
            return montageCache.value.get(cacheKey)!
        }

        let displayName = `${channel1}-${channel2}` // Default fallback

        if (montageToUse !== 'NOT_MONTAGED') {
            const montage = workspaceMontages.value?.find(m => m.name === montageToUse)

            if (montage?.channelPairs) {
                // Search through channel pairs for matching channels
                for (const pairKey of Object.keys(montage.channelPairs)) {
                    const pair = montage.channelPairs[pairKey as unknown as number]

                    if (pair.channels?.length === 2 &&
                        pair.channels[0] === channel1 &&
                        pair.channels[1] === channel2) {
                        displayName = pair.name || displayName
                        break
                    }
                }
            }
        }

        // Cache the result
        montageCache.value.set(cacheKey, displayName)
        return displayName
    }

    /**
     * Process channel details from WebSocket into virtual channel objects
     */
    const processChannelData = (channelDetails: Pick<ChannelDetail, 'id' | 'name'>[] | null | undefined) => {
        if (!Array.isArray(channelDetails)) {
            console.warn('Invalid channel details provided:', channelDetails)
            return []
        }

        const startTime = performance.now()
        processingStats.totalChannels = channelDetails.length
        processingStats.processedChannels = 0
        processingStats.errors = 0

        const virtualChannels = channelDetails.map(({ id, name }) => {
            try {
                const baseChannel = findBaseChannel(id)
                if (!baseChannel) {
                    console.warn(`Base channel not found for ID: ${id}, available base channels:`,
                        baseChannels.value?.map(ch => ({ id: ch?.id, name: ch?.name })) || []
                    )
                    processingStats.errors++
                    return null
                }

                const virtualChannel = createVirtualChannel(id, name, baseChannel)
                processingStats.processedChannels++

                if (isViewingMontage.value) {
                    processingStats.montageChannels++
                }

                return virtualChannel
            } catch (error) {
                console.error(`Error processing channel ${id}:`, error)
                processingStats.errors++
                return null
            }
        }).filter(Boolean)

        processingStats.lastProcessingTime = performance.now() - startTime

        return virtualChannels
    }

    /**
     * Find base channel by ID from the provided base channels
     */
    const findBaseChannel = (channelId: string) => {
        // Check cache first
        if (channelCache.value.has(channelId)) {
            return channelCache.value.get(channelId)
        }

        const baseChannel = baseChannels.value?.find(ch => ch?.id === channelId)

        if (baseChannel) {
            channelCache.value.set(channelId, baseChannel)
        }

        return baseChannel
    }

    /**
     * Create virtual channel object from base channel and montage info
     */
    const createVirtualChannel = (id: string, name: string, baseChannel: ChannelDetail): VirtualChannel => {
        let displayName = name

        // serverId is what server provided (the 'id' parameter)
        const serverId = id

        // For client-side, create unique id
        let uniqueId = id  // Default to server ID

        if (isViewingMontage.value) {
            // Create unique client-side ID for montaged channels
            uniqueId = `${id}_${name}`

            const channelParts = name.split("<->", 2)
            if (channelParts.length === 2) {
                displayName = getDisplayName(channelParts[0], channelParts[1])
            }
        }

        const content = {
            id: uniqueId,            // unique client-side id
            serverId: serverId,      // id the server provided and expects back
            name,
            channelType: baseChannel.channelType,
            label: name,
            displayName,
            unit: baseChannel.unit,
            rate: baseChannel.rate,
            start: baseChannel.start,
            end: baseChannel.end,
            // Additional metadata
            montageScheme: isViewingMontage.value ? viewerMontageScheme.value : 'NOT_MONTAGED',
            isMontaged: isViewingMontage.value,
            baseChannelId: id  // Keep reference for debugging
        }

        return {
            content,
            properties: baseChannel.properties || []
        }
    }

    /**
     * Create montage payload for WebSocket messages
     */
    const createMontagePayload = (montageSchemeName: string) => {
        // Handle the default "NOT_MONTAGED" case
        if (montageSchemeName === "NOT_MONTAGED") {
            return {
                montage: "NOT_MONTAGED",
                packageId: activeViewer.value?.content?.id,
                montageMap: []
            }
        }

        // Find the selected montage by name
        const selectedMontage = workspaceMontages.value.find(m => m.name === montageSchemeName)

        if (!selectedMontage) {
            console.warn('Montage not found:', montageSchemeName)
            return null
        }

        // Convert channelPairs to the array format the server expects
        const montageMap = selectedMontage.channelPairs.map(pair => pair.channels)

        return {
            montage: "CUSTOM_MONTAGE",
            // The store holds an empty activeViewer until a package is activated, so
            // content is optional here as it is in the NOT_MONTAGED branch above.
            packageId: activeViewer.value?.content?.id,
            montageMap: montageMap
        }
    }

    /**
     * Get channel processing statistics
     */
    const getProcessingStats = () => ({
        ...processingStats,
        cacheSize: channelCache.value.size,
        montageCacheSize: montageCache.value.size,
        isViewingMontage: isViewingMontage.value,
        currentMontageScheme: viewerMontageScheme.value,
        availableMontages: workspaceMontages.value?.map(m => m.name) || []
    })

    /**
     * Clear all caches
     */
    const clearCaches = () => {
        channelCache.value.clear()
        montageCache.value.clear()

        // Reset stats
        Object.assign(processingStats, {
            totalChannels: 0,
            processedChannels: 0,
            montageChannels: 0,
            errors: 0,
            lastProcessingTime: 0
        })
    }

    return {
        // State
        processingStats: readonly(processingStats),
        isViewingMontage,
        currentMontage,
        montageChannelPairs,

        // Core processing methods
        getChannelId,
        getDisplayName,
        processChannelData,
        createMontagePayload,

        // Utility methods
        findBaseChannel,
        createVirtualChannel,

        // Management
        getProcessingStats,
        clearCaches
    }
}