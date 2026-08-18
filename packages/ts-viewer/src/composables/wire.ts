// @/composables/wire.ts
//
// Decoded shapes of the inline protobuf schema in useWebSocket.ts, hand-declared
// as the message handling observes them. uint64 fields decode to plain numbers
// because the `long` package is not installed; a value above 2^53 - 1 loses
// precision.

export interface WireEvent {
    source: string
    pageStart: number
    pageEnd: number
    samplePeriod: number
    pointsPerEvent: number
    isResampled: boolean
    data: number[]
    times: number[]
    spikeGroup: number[]
}

export interface WireInstruction {
    command: string
    argument: string
}

export interface WireSegment {
    startTs: number
    source: string
    lastUsed: number
    unit: string
    samplePeriod: number
    requestedSamplePeriod: number
    pageStart: number
    isMinMax: boolean
    unitM: number
    segmentType: string
    nrPoints: number
    data: number[]
    pageEnd: number
    channelName: string
}

export interface WireIngestSegment {
    channelId: string
    startTime: number
    samplePeriod: number
    data: number[]
}

/** One decoded binary frame. Singular message fields are null when absent. */
export interface TimeSeriesMessage {
    segment: WireSegment | null
    event: WireEvent[]
    instruction: WireInstruction | null
    ingestSegment: WireIngestSegment | null
    totalResponses: number
    responseSequenceId: number
}
