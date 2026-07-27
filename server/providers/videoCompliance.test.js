import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createCompliantVideoBuffer } from './videoCompliance.js'

test(
  'writes visible and implicit AI labels into a generated MP4',
  { timeout: 5 * 60 * 1000 },
  async () => {
    const source = await readFile(new URL('../../public/templates/美食3.mp4', import.meta.url))
    const output = await createCompliantVideoBuffer({
      videoBuffer: source,
      taskId: 'test-aigc-watermark',
    })

    const moovOffset = output.indexOf(Buffer.from('moov'))
    const mdatOffset = output.indexOf(Buffer.from('mdat'))
    assert.ok(moovOffset >= 0 && moovOffset < mdatOffset, 'moov metadata atom should be before media data')
    assert.ok(output.indexOf(Buffer.from('AIGC')) > moovOffset, 'AIGC metadata key should exist')
    assert.ok(output.indexOf(Buffer.from('WATERMARKFLAG')) > moovOffset, 'WATERMARKFLAG metadata key should exist')
    assert.ok(output.includes(Buffer.from('"Label":"1"')), 'AIGC metadata should label the content as AI generated')
    assert.ok(
      output.includes(Buffer.from('"ContentProducer":"001191510100321561677C00000"')),
      'AIGC metadata should contain the Migu content producer code',
    )
  },
)
