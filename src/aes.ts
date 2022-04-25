import {AES_asm} from './aes.asm'
import {_heap_init, _heap_write, is_bytes} from './utils'

export class AES {
    public readonly heap: Uint8Array
    public readonly asm: any
    public readonly mode: string
    public readonly padding: boolean
    public pos = 0
    public len = 0

    constructor(key: Uint8Array, iv: Uint8Array | undefined, padding = true, mode: 'CBC') {
        this.mode = mode

        // The AES "worker"
        this.heap = _heap_init().subarray(AES_asm.HEAP_DATA)
        this.asm = new AES_asm(null, this.heap.buffer)

        // The AES object state
        this.pos = 0
        this.len = 0

        // Key
        const keylen = key.length
        if (keylen !== 16 && keylen !== 24 && keylen !== 32) throw new TypeError('illegal key size')

        const keyview = new DataView(key.buffer, key.byteOffset, key.byteLength)
        this.asm.set_key(
            keylen >> 2,
            keyview.getUint32(0),
            keyview.getUint32(4),
            keyview.getUint32(8),
            keyview.getUint32(12),
            keylen > 16 ? keyview.getUint32(16) : 0,
            keylen > 16 ? keyview.getUint32(20) : 0,
            keylen > 24 ? keyview.getUint32(24) : 0,
            keylen > 24 ? keyview.getUint32(28) : 0
        )

        // IV
        if (iv !== undefined) {
            if (iv.length !== 16) throw new TypeError('illegal iv size')

            const ivview = new DataView(iv.buffer, iv.byteOffset, iv.byteLength)

            this.asm.set_iv(
                ivview.getUint32(0),
                ivview.getUint32(4),
                ivview.getUint32(8),
                ivview.getUint32(12)
            )
        } else {
            this.asm.set_iv(0, 0, 0, 0)
        }

        this.padding = padding
    }

    AES_Encrypt_process(data: Uint8Array): Uint8Array {
        if (!is_bytes(data)) throw new TypeError("data isn't of expected type")

        const asm = this.asm
        const heap = this.heap
        const amode = AES_asm.ENC[this.mode]
        const hpos = AES_asm.HEAP_DATA
        let pos = this.pos
        let len = this.len
        let dpos = 0
        let dlen = data.length || 0
        let rpos = 0
        const rlen = (len + dlen) & -16
        let wlen = 0

        const result = new Uint8Array(rlen)

        while (dlen > 0) {
            wlen = _heap_write(heap, pos + len, data, dpos, dlen)
            len += wlen
            dpos += wlen
            dlen -= wlen

            wlen = asm.cipher(amode, hpos + pos, len)

            if (wlen) result.set(heap.subarray(pos, pos + wlen), rpos)
            rpos += wlen

            if (wlen < len) {
                pos += wlen
                len -= wlen
            } else {
                pos = 0
                len = 0
            }
        }

        this.pos = pos
        this.len = len

        return result
    }

    AES_Encrypt_finish(): Uint8Array {
        const asm = this.asm
        const heap = this.heap
        const amode = AES_asm.ENC[this.mode]
        const hpos = AES_asm.HEAP_DATA
        const pos = this.pos
        let len = this.len
        const plen = 16 - (len % 16)
        let rlen = len

        // if (this.hasOwnProperty('padding')) {
        if (this.padding) {
            for (let p = 0; p < plen; ++p) {
                heap[pos + len + p] = plen
            }
            len += plen
            rlen = len
        } else if (len % 16) {
            throw new TypeError('data length must be a multiple of the block size')
        }
        // } else {
        //     len += plen
        // }

        const result = new Uint8Array(rlen)

        if (len) asm.cipher(amode, hpos + pos, len)

        if (rlen) result.set(heap.subarray(pos, pos + rlen))

        this.pos = 0
        this.len = 0

        return result
    }

    AES_Decrypt_process(data: Uint8Array): Uint8Array {
        if (!is_bytes(data)) throw new TypeError("data isn't of expected type")

        const asm = this.asm
        const heap = this.heap
        const amode = AES_asm.DEC[this.mode]
        const hpos = AES_asm.HEAP_DATA
        let pos = this.pos
        let len = this.len
        let dpos = 0
        let dlen = data.length || 0
        let rpos = 0
        let rlen = (len + dlen) & -16
        let plen = 0
        let wlen = 0

        if (this.padding) {
            plen = len + dlen - rlen || 16
            rlen -= plen
        }

        const result = new Uint8Array(rlen)

        while (dlen > 0) {
            wlen = _heap_write(heap, pos + len, data, dpos, dlen)
            len += wlen
            dpos += wlen
            dlen -= wlen

            wlen = asm.cipher(amode, hpos + pos, len - (!dlen ? plen : 0))

            if (wlen) result.set(heap.subarray(pos, pos + wlen), rpos)
            rpos += wlen

            if (wlen < len) {
                pos += wlen
                len -= wlen
            } else {
                pos = 0
                len = 0
            }
        }

        this.pos = pos
        this.len = len

        return result
    }

    AES_Decrypt_finish(): Uint8Array {
        const asm = this.asm
        const heap = this.heap
        const amode = AES_asm.DEC[this.mode]
        const hpos = AES_asm.HEAP_DATA
        const pos = this.pos
        const len = this.len
        let rlen = len

        if (len > 0) {
            if (len % 16) {
                // if (this.hasOwnProperty('padding')) {
                throw new Error('data length must be a multiple of the block size')
                // } else {
                // len += 16 - (len % 16)
                // }
            }

            asm.cipher(amode, hpos + pos, len)

            if (/*this.hasOwnProperty('padding')  &&*/ this.padding) {
                const pad = heap[pos + rlen - 1]
                if (pad < 1 || pad > 16 || pad > rlen) throw new Error('bad padding')

                let pcheck = 0
                for (let i = pad; i > 1; i--) pcheck |= pad ^ heap[pos + rlen - i]
                if (pcheck) throw new Error('bad padding')

                rlen -= pad
            }
        }

        const result = new Uint8Array(rlen)

        if (rlen > 0) {
            result.set(heap.subarray(pos, pos + rlen))
        }

        this.pos = 0
        this.len = 0

        return result
    }
}
