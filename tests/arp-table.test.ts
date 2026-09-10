import { describe, expect, it } from 'vitest'
import { parseArpTable } from '../src/main/nas/discovery'

// La búsqueda de servidores lee `arp -a`, cuyo formato cambia por completo entre macOS y
// Windows (y en Windows además sale traducido). Sin PC a mano, esto fija ambos formatos.

describe('parseArpTable', () => {
  it('macOS: IPs entre paréntesis, sin incompletas, difusión ni multidifusión', () => {
    const output = [
      '? (192.168.1.1) at 0:11:22:33:44:55 on en0 ifscope [ethernet]',
      '? (192.168.1.20) at (incomplete) on en0 ifscope [ethernet]',
      '? (192.168.1.255) at ff:ff:ff:ff:ff:ff on en0 ifscope [ethernet]',
      '? (224.0.0.251) at 1:0:5e:0:0:fb on en0 ifscope permanent [ethernet]',
      'nas.local (192.168.1.100) at 0:11:32:aa:bb:cc on en0 ifscope [ethernet]'
    ].join('\n')

    expect(parseArpTable(output)).toEqual(['192.168.1.1', '192.168.1.100'])
  })

  it('Windows en español: columnas con MAC con guiones, CRLF y cabecera de interfaz', () => {
    const output = [
      '',
      'Interfaz: 192.168.1.5 --- 0x7',
      '  Dirección de Internet          Dirección física      Tipo',
      '  192.168.1.1           00-11-22-33-44-55     dinámico',
      '  192.168.1.100         00-11-32-aa-bb-cc     dinámico',
      '  192.168.1.255         ff-ff-ff-ff-ff-ff     estático',
      '  224.0.0.22            01-00-5e-00-00-16     estático',
      '  239.255.255.250       01-00-5e-7f-ff-fa     estático',
      '  255.255.255.255       ff-ff-ff-ff-ff-ff     estático'
    ].join('\r\n')

    expect(parseArpTable(output)).toEqual(['192.168.1.1', '192.168.1.100'])
  })
})
