import { describe, expect, it } from 'vitest'
import { CategoryIndex } from '../domain/categories'
import { classifyWithRules } from '../domain/classifier/pipeline'
import type { AiHost } from '../infra/backend'
import { type AiStatus, LunarError, type LocalModel } from '../infra/contracts'
import { cat, mov, rule, withCategory } from '../test/factories'
import {
  AI_PRESELECT_CONFIDENCE,
  OllamaProvider,
  aggregatePull,
  aiState,
  chooseModel,
  findSimilarCategories,
  preselect,
  proposeWithAi,
  recommendDownload,
  suggestRules,
  suitableModels,
} from './ai'

const GB = 1024 ** 3
const model = (name: string, over: Partial<LocalModel> = {}): LocalModel => ({ name, size: 1, family: name.split(':')[0], parameterSize: null, quantization: null, capabilities: ['completion'], ...over })
const status = (over: Partial<AiStatus> = {}): AiStatus => ({
  installed: true,
  canStart: true,
  running: true,
  version: '0.40.6',
  models: [model('gemma3:4b')],
  resources: { totalMemoryBytes: 14 * GB, freeDiskBytes: 70 * GB },
  ...over,
})

const food = cat('Alimentación')
const fun = cat('Ocio')
const transport = cat('Transporte')
const salary = cat('Nómina', { kind: 'income' })
const old = cat('Viejo', { status: 'archived' })
const idx = new CategoryIndex([food, fun, transport, salary, old])

function fakeAi(reply: (input: Parameters<AiHost['classify']>[1]) => Promise<{ categoryId: string | null; confidence: number; reason: string }>): AiHost & { calls: number; lastCategories: string[] } {
  const host = {
    calls: 0,
    lastCategories: [] as string[],
    status: async () => status(),
    start: async () => status(),
    pull: async () => true,
    cancelPull: async () => {},
    classify: async (_m: string, input: Parameters<AiHost['classify']>[1]) => {
      host.calls++
      host.lastCategories = input.categories.map((c) => c.name)
      return reply(input)
    },
    matchCategory: async () => ({ categoryId: null, confidence: 0, reason: '' }),
    reviewDuplicates: async () => [],
    openDownloadPage: async () => {},
  }
  return host
}

describe('detección y elección de modelo', () => {
  it('distingue no instalado, detenido, sin modelo, disponible y no admitido', () => {
    expect(aiState(status({ installed: false, running: false }), true, null)).toBe('not_installed')
    expect(aiState(status({ running: false }), true, null)).toBe('stopped')
    expect(aiState(status({ models: [] }), true, null)).toBe('no_model')
    expect(aiState(status(), true, 'gemma3:4b')).toBe('ready')
    expect(aiState(null, false, null)).toBe('unsupported')
  })

  it('reutiliza el modelo instalado y no asume que se llame gemma3:latest', () => {
    expect(chooseModel(status(), null)).toBe('gemma3:4b')
    expect(chooseModel(status({ models: [model('gemma3:1b-it-qat'), model('llama3.2:3b', { family: 'llama' })] }), null)).toBe('gemma3:1b-it-qat')
    expect(chooseModel(status({ models: [model('gemma3:4b'), model('qwen3:4b', { family: 'qwen3' })] }), 'qwen3:4b')).toBe('qwen3:4b')
    expect(chooseModel(status(), 'gemma3:latest')).toBe('gemma3:4b')
    expect(chooseModel(status({ running: false }), 'gemma3:4b')).toBeNull()
  })

  it('descarta modelos de embeddings o sin generación de texto', () => {
    const list = suitableModels([model('nomic-embed-text:latest', { capabilities: ['embedding'], family: 'nomic-bert' }), model('all-minilm:l6', { capabilities: [] }), model('gemma3:4b')])
    expect(list.map((m) => m.name)).toEqual(['gemma3:4b'])
  })

  it('recomienda según memoria y disco, sin imponer el modelo grande', () => {
    expect(recommendDownload({ totalMemoryBytes: 14 * GB, freeDiskBytes: 70 * GB }).name).toBe('gemma3:4b')
    expect(recommendDownload({ totalMemoryBytes: 32 * GB, freeDiskBytes: 70 * GB }).name).toBe('gemma3:12b')
    expect(recommendDownload({ totalMemoryBytes: 6 * GB, freeDiskBytes: 70 * GB }).name).toBe('gemma3:1b')
    expect(recommendDownload({ totalMemoryBytes: 32 * GB, freeDiskBytes: 2 * GB }).name).toBe('gemma3:1b')
    expect(recommendDownload({ totalMemoryBytes: null, freeDiskBytes: null }).name).toBe('gemma3:1b')
  })

  it('agrega el progreso real de las capas de la descarga', () => {
    const layers = new Map([
      ['a', { completed: 500, total: 1000 }],
      ['b', { completed: 0, total: 3000 }],
    ])
    expect(aggregatePull(layers, 'pulling b')).toEqual({ status: 'pulling b', completed: 500, total: 4000 })
  })
})

describe('clasificación con IA', () => {
  const pending = (description: string) => mov({ description, categoryLink: null })
  const ruleSet = [rule('mercadona', food)]
  const review = (ms: ReturnType<typeof pending>[]) => ms.map((movement) => ({ movement, proposal: classifyWithRules(movement, { categories: idx, rules: ruleSet }) }))

  it('solo consulta a la IA lo que las reglas no resuelven, y solo con categorías activas y compatibles', async () => {
    const ai = fakeAi(async () => ({ categoryId: fun.id, confidence: 0.92, reason: 'bolera' }))
    const r = await proposeWithAi(review([pending('Mercadona'), pending('Bolera')]), new OllamaProvider(ai, 'gemma3:4b'), idx, ruleSet, () => {})
    expect(ai.calls).toBe(1)
    expect(ai.lastCategories.sort()).toEqual(['Alimentación', 'Ocio', 'Transporte'])
    expect(r.items[0].proposal.source).toBe('rule')
    expect(r.items[1].proposal).toMatchObject({ status: 'proposed', source: 'ai', categoryId: fun.id, confidence: 'high', needsConfirmation: true })
    expect(preselect(r.items[1].proposal)).toBe(true)
  })

  it('una propuesta de baja confianza no se marca: requiere confirmación', async () => {
    const ai = fakeAi(async () => ({ categoryId: fun.id, confidence: AI_PRESELECT_CONFIDENCE - 0.2, reason: 'quizá' }))
    const r = await proposeWithAi(review([pending('Pago XJ-22')]), new OllamaProvider(ai, 'm'), idx, ruleSet, () => {})
    expect(r.items[0].proposal.status).toBe('proposed')
    expect(preselect(r.items[0].proposal)).toBe(false)
  })

  it('si la IA contradice tu historial, la propuesta baja de confianza y no se marca', async () => {
    const health = cat('Salud')
    const cats2 = new CategoryIndex([food, fun, transport, health, cat('Ropa')])
    const history = [withCategory(mov({ description: 'Óptica Sol' }), health), withCategory(mov({ description: 'Optica Gran Vía' }), health)]
    const ai = fakeAi(async () => ({ categoryId: cats2.findByName('Ropa')!.id, confidence: 0.95, reason: 'gafas' }))
    const items = [pending('Óptica')].map((movement) => ({ movement, proposal: classifyWithRules(movement, { categories: cats2, rules: [] }) }))
    const r = await proposeWithAi(items, new OllamaProvider(ai, 'm'), cats2, [], () => {}, undefined, history)
    expect(r.items[0].proposal).toMatchObject({ status: 'proposed', confidence: 'low' })
    expect(r.items[0].proposal.reason).toMatch(/Tu historial: Salud/)
    expect(preselect(r.items[0].proposal)).toBe(false)

    const agree = fakeAi(async () => ({ categoryId: health.id, confidence: 0.95, reason: 'gafas' }))
    const ok = await proposeWithAi(items, new OllamaProvider(agree, 'm'), cats2, [], () => {}, undefined, history)
    expect(preselect(ok.items[0].proposal)).toBe(true)
  })

  it('rechaza categorías inexistentes, archivadas o incompatibles', async () => {
    for (const categoryId of ['no-existe', old.id, salary.id]) {
      const ai = fakeAi(async () => ({ categoryId, confidence: 0.99, reason: '' }))
      const r = await proposeWithAi(review([pending('Algo')]), new OllamaProvider(ai, 'm'), idx, ruleSet, () => {})
      expect(r.items[0].proposal.status).not.toBe('proposed')
      expect(r.failures).toHaveLength(1)
    }
  })

  it('si la IA no ve una categoría clara, el movimiento sigue pendiente', async () => {
    const ai = fakeAi(async () => ({ categoryId: null, confidence: 0.2, reason: 'ambiguo' }))
    const r = await proposeWithAi(review([pending('Transferencia 3321')]), new OllamaProvider(ai, 'm'), idx, ruleSet, () => {})
    expect(r.items[0].proposal.status).not.toBe('proposed')
    expect(r.items[0].proposal.categoryId).toBeNull()
  })

  it('una respuesta inválida o un tiempo agotado no rompen el lote', async () => {
    let n = 0
    const ai = fakeAi(async () => {
      n++
      if (n === 1) throw new LunarError({ code: 'validation', message: 'Respuesta del modelo no válida.' })
      if (n === 2) throw new LunarError({ code: 'server', message: 'Ollama tardó demasiado en responder.' })
      return { categoryId: transport.id, confidence: 0.9, reason: 'tren' }
    })
    const r = await proposeWithAi(review([pending('a'), pending('b'), pending('Renfe')]), new OllamaProvider(ai, 'm'), idx, ruleSet, () => {})
    expect(r.failures.map((f) => f.error.code)).toEqual(['validation', 'server'])
    expect(r.items[2].proposal.categoryId).toBe(transport.id)
    expect(r.stopped).toBe(false)
  })

  it('se detiene si Ollama deja de responder', async () => {
    const ai = fakeAi(async () => {
      throw new LunarError({ code: 'offline', message: 'Ollama no responde.' })
    })
    const r = await proposeWithAi(review([pending('a'), pending('b')]), new OllamaProvider(ai, 'm'), idx, ruleSet, () => {})
    expect(r.stopped).toBe(true)
    expect(ai.calls).toBe(1)
    expect(r.items.every((it) => it.proposal.status !== 'proposed')).toBe(true)
  })

  it('se puede cancelar', async () => {
    const ctrl = new AbortController()
    const ai = fakeAi(async () => {
      ctrl.abort()
      return { categoryId: fun.id, confidence: 0.9, reason: '' }
    })
    const r = await proposeWithAi(review([pending('a'), pending('b'), pending('c')]), new OllamaProvider(ai, 'm'), idx, ruleSet, () => {}, ctrl.signal)
    expect(ai.calls).toBe(1)
    expect(r.stopped).toBe(true)
  })

  it('sin IA la clasificación por reglas funciona igual', () => {
    const p = classifyWithRules(pending('MERCADONA 22'), { categories: idx, rules: ruleSet })
    expect(p).toMatchObject({ status: 'proposed', source: 'rule', categoryId: food.id })
  })
})

describe('organización de categorías', () => {
  it('detecta plurales y erratas del mismo tipo, sin mezclar gastos e ingresos', () => {
    const pairs = findSimilarCategories([cat('Restaurante'), cat('Restaurantes'), cat('Transprte'), cat('Transporte'), cat('Regalos'), cat('Regalo', { kind: 'income' })])
    expect(pairs.map((p) => `${p.a.name}/${p.b.name}`).sort()).toEqual(['Restaurante/Restaurantes', 'Transprte/Transporte'])
  })

  it('sugiere reglas para descripciones repetidas que ninguna regla cubre', () => {
    const ms = [
      ...Array.from({ length: 4 }, () => withCategory(mov({ description: 'Cabify viaje' }), transport)),
      withCategory(mov({ description: 'Cabify viaje' }), fun),
      ...Array.from({ length: 3 }, () => withCategory(mov({ description: 'Mercadona' }), food)),
      ...Array.from({ length: 2 }, () => withCategory(mov({ description: 'Zara' }), fun)),
    ]
    const s = suggestRules(ms, [rule('mercadona', food)], idx)
    expect(s.map((x) => [x.pattern, x.category.name, x.count])).toEqual([['cabify', 'Transporte', 5]])
  })
})
