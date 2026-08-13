// dsh 容器端口中继：dsh web 只绑定 127.0.0.1（官方安全设计），
// 此中继绑定容器 eth0 IP，供 docker -p 端口映射接入。
// 注意: 不能绑 0.0.0.0 —— 会与 dsh 的 127.0.0.1:3080 冲突（Linux 下 EADDRINUSE）。
import net from 'node:net'
import os from 'node:os'

const listenPort = Number(process.argv[2] ?? 3080)
const targetHost = process.argv[3] ?? '127.0.0.1'
const targetPort = Number(process.argv[4] ?? 3080)

function containerIp() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const iface of list ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address
    }
  }
  return undefined
}

const host = process.env.RELAY_HOST ?? containerIp() ?? '0.0.0.0'
const server = net.createServer((client) => {
  const upstream = net.connect(targetPort, targetHost)
  client.pipe(upstream)
  upstream.pipe(client)
  client.on('error', () => upstream.destroy())
  upstream.on('error', () => client.destroy())
})
server.listen(listenPort, host, () => {
  console.log(`[relay] ${host}:${listenPort} -> ${targetHost}:${targetPort}`)
})
server.on('error', (err) => {
  console.error(`[relay] fatal: ${err.message}`)
  process.exit(1)
})
