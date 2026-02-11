export const useChannelDataRequest = () => {

  const openConnection = async (timeseriesDiscoverApi, packageId, userToken) => {

    const myConnectionPromise = new Promise((resolve, reject) => {
      const url = timeseriesDiscoverApi + '?session=' + userToken + '&package=' + packageId
      let response = null

      const ws = new WebSocket(url)

      ws.onopen = () => {
        const payload = { montage: 'NOT_MONTAGED', packageId: packageId }
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