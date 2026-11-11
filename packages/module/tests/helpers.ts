import assert from 'node:assert/strict'
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http'
import net from 'node:net'
/** Lo que comparten las pruebas del servidor y del arranque. Sale de las ayudas de las pruebas de una vertical anterior en producción. */
export type Reply = { status: number; headers: IncomingHttpHeaders | Record<string, string>; body: string; bytes?: number }

/** Una petición con `node:http`, con la ruta tal cual (sin normalizar) y sin conexión reutilizada. */
export function call(port: number, method: string, path: string, headers: Record<string, string> = {}, body?: string | Buffer): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, method, path, headers, agent: false }, res => {
      let data = ''
      res.setEncoding('utf8').on('data', chunk => { data += chunk }).on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: data }))
    })
    req.on('error', reject)
    req.end(body)
  })
}

/** Bytes tal cual por un socket: para `*`, la forma absoluta y lo que Node no entiende. La respuesta, cuando el servidor cierra. */
export function raw(port: number, bytes: string | Buffer): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1')
    const chunks: Buffer[] = []
    socket.on('data', chunk => chunks.push(chunk)).on('error', reject).on('close', () => {
      const data = Buffer.concat(chunks), end = data.indexOf('\r\n\r\n')
      const [status, ...lines] = data.subarray(0, end).toString('latin1').split('\r\n')
      const headers = Object.fromEntries(lines.map(line => [line.slice(0, line.indexOf(':')).trim().toLowerCase(), line.slice(line.indexOf(':') + 1).trim()]))
      resolve({ status: Number(status.split(' ')[1]), headers, body: data.subarray(end + 4).toString('utf8'), bytes: data.length - end - 4 })
    })
    socket.write(bytes)
  })
}

/** La petición tal cual por un socket, con `Host` y `Connection: close`. */
export function rawRequest(port: number, method: string, target: string, headers: Record<string, string> = {}): Promise<Reply> {
  const extra = Object.entries(headers).map(([name, value]) => `${name}: ${value}\r\n`).join('')
  return raw(port, `${method} ${target} HTTP/1.1\r\nHost: 127.0.0.1\r\n${extra}Connection: close\r\n\r\n`)
}

/** Las cabeceras de toda respuesta de la API del módulo, también las de error y las de peticiones mal formadas. */
export function moduleHeaders(reply: Reply, label: string) {
  assert.equal(reply.headers['content-security-policy'], "default-src 'none'; frame-ancestors 'none'", label)
  assert.equal(reply.headers['x-content-type-options'], 'nosniff', label)
  assert.equal(reply.headers['referrer-policy'], 'no-referrer', label)
  assert.equal(reply.headers['cache-control'], 'no-store', label)
  for (const name of ['strict-transport-security', 'x-powered-by', 'set-cookie', 'location']) assert.equal(reply.headers[name], undefined, `${label}: ${name}`)
  assert.equal(Number(reply.headers['content-length']), reply.bytes ?? Buffer.byteLength(reply.body), label)
}

export const ID = '00000000-0000-4000-8000-000000000001'
export const RID = '00000000-0000-4000-8000-000000000002'
