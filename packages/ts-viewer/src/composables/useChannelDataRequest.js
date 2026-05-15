export const useChannelDataRequest = () => {

  const openConnection = async (timeseriesDiscoverApi, id, userToken, paramName = 'viewerAsset', packageId = null) => {

    const myConnectionPromise = new Promise((resolve, reject) => {
      let url = timeseriesDiscoverApi + '?session=' + userToken + '&' + paramName + '=' + id
      if (packageId && paramName !== 'package') {
        url += '&package=' + packageId
      }
      let response = null

      const ws = new WebSocket(url)

      ws.onopen = () => {
        const payload = { montage: 'NOT_MONTAGED', packageId: id }
        ws.send(JSON.stringify(payload))
      }

      ws.onclose = () => {
        if (response && response.channelDetails) {
          resolve({res: response.channelDetails, status: 'websocket closed'})
        } else {
          resolve({res: null, status: 'websocket closed without data'})
        }
      }

      ws.onmessage = (event) => {
        response = JSON.parse(event.data)
        ws.close()
      }

      ws.onerror = (error) => {
        console.error('WebSocket error:', error)
        reject(error)
      }
    })



    const resolvedData = await myConnectionPromise

    return resolvedData
  }


  return {
    openConnection
  }
}