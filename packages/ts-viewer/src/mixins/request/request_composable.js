// request_composable.js

import EventBus from '@/utils/event-bus';

const _isString = (x) => Object.prototype.toString.call(x) === '[object String]'

const _trimValues = (obj) => {
    Object.keys(obj).forEach(key => {
        if (_isString(obj[key])) {
            obj[key] = obj[key].trim()
        }
    })
}

/**
 * Send Xhr request
 * @param {string} url
 * @param {{method: string; header: {Authorization: string}; body: []}} opts  Error status
 * @param {string} opts.method
 * @param {Object} opts.header
 * @param {Object} opts.body
 */
export function useSendXhr(url, opts) {

    if (!url) {
        return Promise.reject({status: 400, message: 'Url is missing!'})
    }

    const method = opts?.method ?? 'GET'

    const optsHeader = opts?.header ?? {}
    const headers = Object.assign({}, { 'Content-type': 'application/json' }, optsHeader)

    const optsBody = opts?.body
    let requestOpts = { headers, method: method }

    if (optsBody) {
        if (typeof optsBody === 'object') {
            _trimValues(optsBody)
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

/**
 * Handles ajax errors
 * @param {Object} err
 * @param {number} err.status  Error status
 * @param {ReadableStream} err.body Error body.
 */
export function useHandleXhrError(err) {
    const status = err?.status
    if (status === undefined) {
        console.error(err)
        return
    }

    if (status === 400 && err.body) {
        err.body.getReader().read().then(({ value }) => {
            const strData = value instanceof Uint8Array ? String.fromCharCode.apply(null, value) : value
            let errorMsg = strData
            try {
                errorMsg = JSON.parse(strData)?.message ?? strData
            } catch {
                // Not JSON; show the raw body
            }
            EventBus.$emit('ajaxError', {
                detail: {
                    type: 'error',
                    msg: errorMsg
                }
            })
        })
    }
    else if (status === 401) {
        console.error('Request failed with status 401')
        EventBus.$emit('ajaxError', {
            detail: {
                type: 'error',
                msg: 'Session expired. Sign in again to continue.'
            }
        })
    }
    else {
        err.json().then(errorJson => {
          if (errorJson) {
            const msg = errorJson.message
            EventBus.$emit('ajaxError', {
              detail: {
                type: 'info',
                msg: msg,
              }
            })
          } else {
            EventBus.$emit('ajaxError', {
              detail: {
                type: 'error',
                msg: `Request failed with status ${status}`
              }
            })
          }
        })
  }
}