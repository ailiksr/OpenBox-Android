import dns from 'node:dns'
import net from 'node:net'

export const setupAndroidDns = () => {
  try {
    dns.setServers(['223.5.5.5', '119.29.29.29', '180.76.76.76', '8.8.8.8', '1.1.1.1'])
  } catch (err) {
    console.warn('[android-dns] setServers failed:', err)
  }

  const origLookup = dns.lookup

  dns.lookup = function (hostname, options, callback) {
    let cb = callback
    let opts = options
    if (typeof opts === 'function') {
      cb = opts
      opts = {}
    }

    if (net.isIP(hostname)) {
      return origLookup.call(dns, hostname, opts, cb)
    }

    dns.resolve4(hostname, (err, addrs) => {
      if (!err && addrs && addrs.length > 0) {
        if (opts && opts.all) {
          return cb(null, addrs.map((a) => ({ address: a, family: 4 })))
        }
        return cb(null, addrs[0], 4)
      }
      dns.resolve6(hostname, (err6, addrs6) => {
        if (!err6 && addrs6 && addrs6.length > 0) {
          if (opts && opts.all) {
            return cb(null, addrs6.map((a) => ({ address: a, family: 6 })))
          }
          return cb(null, addrs6[0], 6)
        }
        origLookup.call(dns, hostname, opts, cb)
      })
    })
  }

  dns.promises.lookup = function (hostname, options) {
    return new Promise((resolve, reject) => {
      dns.lookup(hostname, options, (err, address, family) => {
        if (err) return reject(err)
        if (options && options.all) return resolve(address)
        resolve({ address, family })
      })
    })
  }

  console.log('[android-dns] Android DNS polyfill initialized (AliDNS / TencentDNS / GoogleDNS)')
}
