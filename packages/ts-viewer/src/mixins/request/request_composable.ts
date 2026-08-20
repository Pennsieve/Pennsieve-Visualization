// request_composable.ts

import { useViewerEmitter } from '@/events/emitter';

const _isString = (x: unknown): x is string => Object.prototype.toString.call(x) === '[object String]'

const _trimValues = (obj: Record<string, unknown>) => {
    Object.keys(obj).forEach(key => {
        if (_isString(obj[key])) {
            obj[key] = obj[key].trim()
        }
    })
}

interface XhrOptions {
    method?: string
    header?: Record<string, string>
    body?: unknown
}

export function useSendXhr(url: string, opts?: XhrOptions): Promise<unknown> {

    if (!url) {
        return Promise.reject({status: 400, message: 'Url is missing!'})
    }

    const method = opts?.method ?? 'GET'

    const optsHeader = opts?.header ?? {}
    const headers = Object.assign({}, { 'Content-type': 'application/json' }, optsHeader)

    const optsBody = opts?.body
    let requestOpts: RequestInit = { headers, method: method }

    if (optsBody) {
        if (typeof optsBody === 'object') {
            _trimValues(optsBody as Record<string, unknown>)
        }
        const body = JSON.stringify(optsBody)
        requestOpts = Object.assign({}, requestOpts, { body: body })
    }

    return fetch(url, requestOpts)
        .then(resp => {
            if (resp.status >= 400) {
                return Promise.reject(resp)
            }
            // if the payload cannot be converted to json, just return the original response


            return resp.json()
            .catch(() => {
                return resp
            })

        })
}

export function useHandleXhrError(err: unknown) {
    // No component is current inside an async catch block, so this resolves to
    // the unscoped emitter and the message reaches every mounted viewer.
    const emitter = useViewerEmitter()
    const error = err as {
        status?: number
        body?: ReadableStream<Uint8Array>
        json(): Promise<{ message?: string } | null>
    }
    const status = error?.status
    if (status === undefined) {
        console.error(err)
        return
    }

    if (status === 400 && error.body) {
        error.body.getReader().read().then(({ value }) => {
            const strData = value instanceof Uint8Array ? String.fromCharCode.apply(null, value as unknown as number[]) : value
            let errorMsg = strData
            try {
                errorMsg = JSON.parse(strData!)?.message ?? strData
            } catch {
                // Not JSON; show the raw body
            }
            emitter.emit('ajaxError', {
                detail: {
                    type: 'error',
                    msg: errorMsg
                }
            })
        })
    }
    else if (status === 401) {
        console.error('Request failed with status 401')
        emitter.emit('ajaxError', {
            detail: {
                type: 'error',
                msg: 'Session expired. Sign in again to continue.'
            }
        })
    }
    else {
        // A failed request can answer with a plain text or an empty body. The status
        // stands in when the body carries no message.
        error.json().catch(() => null).then(errorJson => {
          const msg = errorJson?.message
          if (msg) {
            emitter.emit('ajaxError', {
              detail: {
                type: 'info',
                msg: msg,
              }
            })
          } else {
            emitter.emit('ajaxError', {
              detail: {
                type: 'error',
                msg: `Request failed with status ${status}`
              }
            })
          }
        })
  }
}
