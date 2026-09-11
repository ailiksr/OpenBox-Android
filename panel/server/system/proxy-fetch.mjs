import http from 'node:http'
import https from 'node:https'
import tls from 'node:tls'

// 当 sing-box 运行时通过 127.0.0.1:7891 本地代理端口访问，未运行时平滑回退到系统直连/镜像
export const proxyFetch = (urlStr, init = {}) => new Promise((resolve, reject) => {
  let target
  try {
    target = new URL(String(urlStr))
  } catch (err) {
    reject(err)
    return
  }

  const signal = init.signal
  if (signal?.aborted) {
    reject(new Error('aborted'))
    return
  }

  const proxyReq = http.request({
    host: '127.0.0.1',
    port: 7891,
    method: 'CONNECT',
    path: `${target.hostname}:${target.port || (target.protocol === 'https:' ? 443 : 80)}`,
    signal
  })

  let handled = false
  const fallback = () => {
    if (handled) return
    handled = true
    try { proxyReq.destroy() } catch {}
    globalThis.fetch(urlStr, init).then(resolve, reject)
  }

  proxyReq.setTimeout(4000, () => {
    fallback()
  })

  proxyReq.on('connect', (res, socket) => {
    if (handled) return
    if (res.statusCode !== 200) {
      try { socket.destroy() } catch {}
      fallback()
      return
    }

    if (target.protocol === 'https:') {
      const tlsSocket = tls.connect({ socket, servername: target.hostname }, () => {
        if (handled) return
        const req = https.request({
          path: target.pathname + target.search,
          method: init.method || 'GET',
          createConnection: () => tlsSocket,
          headers: {
            'Host': target.hostname,
            'User-Agent': 'Open-Box Ruleset Downloader',
            'Accept': '*/*',
            ...(init.headers || {})
          },
          signal
        }, (response) => {
          const chunks = []
          response.on('data', (c) => chunks.push(c))
          response.on('end', () => {
            if (handled) return
            handled = true
            const buf = Buffer.concat(chunks)
            const respHeaders = new Headers()
            for (const [k, v] of Object.entries(response.headers)) {
              if (v !== undefined) respHeaders.set(k, Array.isArray(v) ? v.join(', ') : String(v))
            }
            resolve({
              ok: response.statusCode >= 200 && response.statusCode < 300,
              status: response.statusCode,
              headers: respHeaders,
              arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
              text: async () => buf.toString('utf8'),
              json: async () => JSON.parse(buf.toString('utf8'))
            })
          })
        })
        req.on('error', fallback)
        req.end()
      })
      tlsSocket.on('error', fallback)
    } else {
      const req = http.request({
        path: target.pathname + target.search,
        method: init.method || 'GET',
        createConnection: () => socket,
        headers: {
          'Host': target.hostname,
          'User-Agent': 'Open-Box Ruleset Downloader',
          ...(init.headers || {})
        },
        signal
      }, (response) => {
        const chunks = []
        response.on('data', (c) => chunks.push(c))
        response.on('end', () => {
          if (handled) return
          handled = true
          const buf = Buffer.concat(chunks)
          const respHeaders = new Headers()
          for (const [k, v] of Object.entries(response.headers)) {
            if (v !== undefined) respHeaders.set(k, Array.isArray(v) ? v.join(', ') : String(v))
          }
          resolve({
            ok: response.statusCode >= 200 && response.statusCode < 300,
            status: response.statusCode,
            headers: respHeaders,
            arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
            text: async () => buf.toString('utf8'),
            json: async () => JSON.parse(buf.toString('utf8'))
          })
        })
      })
      req.on('error', fallback)
      req.end()
    }
  })

  proxyReq.on('error', fallback)
  proxyReq.end()
})
