import { describe, expect, it } from 'vitest'
import { cat, index, mov, rule } from '../../test/factories'
import { ClassificationPipeline, type ClassificationProvider, classifyWithRules, validateSuggestion } from './pipeline'
import { compareRules, detectConflicts, evaluateRules, parseRulesDocument, ruleMatches, suggestPattern, textMatches, validateRule } from './rules'

const ocio = cat('Ocio')
const food = cat('Alimentación')
const ropa = cat('Ropa')
const subs = cat('Suscripciones')
const transporte = cat('Transporte')
const nomina = cat('Nómina', { kind: 'income' })
const viejo = cat('Antigua', { status: 'archived' })
const cats = index([ocio, food, ropa, subs, transporte, nomina, viejo])

describe('coincidencias normalizadas', () => {
  it('ignora mayúsculas, espacios repetidos y acentos', () => {
    expect(textMatches({ pattern: 'mercadona', match: 'contains', accentSensitive: false }, 'COMPRA  MERCADONA 1234')).toBe(true)
    expect(textMatches({ pattern: 'cafe', match: 'contains', accentSensitive: false }, 'Café con leche')).toBe(true)
    expect(textMatches({ pattern: 'Café', match: 'contains', accentSensitive: false }, 'cafe solo')).toBe(true)
  })

  it('distingue acentos solo si la regla lo pide', () => {
    expect(textMatches({ pattern: 'año', match: 'word', accentSensitive: true }, 'Cuota del ano')).toBe(false)
    expect(textMatches({ pattern: 'año', match: 'word', accentSensitive: true }, 'Cuota del AÑO')).toBe(true)
  })

  it('«palabra» exige palabras completas', () => {
    expect(textMatches({ pattern: 'bar', match: 'word', accentSensitive: false }, 'Bar Manolo')).toBe(true)
    expect(textMatches({ pattern: 'bar', match: 'word', accentSensitive: false }, 'Barcelona')).toBe(false)
    expect(textMatches({ pattern: 'el corte', match: 'word', accentSensitive: false }, 'Compra El Corte Inglés')).toBe(true)
  })

  it('«empieza por» y «es exactamente»', () => {
    expect(textMatches({ pattern: 'renfe', match: 'startsWith', accentSensitive: false }, 'Renfe Cercanías')).toBe(true)
    expect(textMatches({ pattern: 'renfe', match: 'startsWith', accentSensitive: false }, 'Billete Renfe')).toBe(false)
    expect(textMatches({ pattern: 'spotify', match: 'equals', accentSensitive: false }, ' SPOTIFY ')).toBe(true)
    expect(textMatches({ pattern: 'spotify', match: 'equals', accentSensitive: false }, 'Spotify Premium')).toBe(false)
  })

  it('un patrón vacío nunca coincide', () => {
    expect(textMatches({ pattern: '   ', match: 'contains', accentSensitive: false }, 'algo')).toBe(false)
  })
})

describe('clasificación por reglas', () => {
  const rules = [
    rule('Discoteca', ocio),
    rule('Mercadona', food),
    rule('Zara', ropa, { match: 'word' }),
    rule('Spotify', subs),
    rule('Renfe', transporte),
  ]

  it.each([
    ['Discoteca Fabrik', 'Ocio'],
    ['MERCADONA AV. AMERICA', 'Alimentación'],
    ['Zara Gran Vía', 'Ropa'],
    ['Spotify P0123', 'Suscripciones'],
    ['renfe ave madrid', 'Transporte'],
  ])('«%s» → %s', (description, expected) => {
    const p = classifyWithRules(mov({ description }), { categories: cats, rules })
    expect(p.status).toBe('proposed')
    expect(cats.get(p.categoryId)?.name).toBe(expected)
    expect(p.source).toBe('rule')
  })

  it('sin coincidencias no inventa categoría y explica el motivo', () => {
    const p = classifyWithRules(mov({ description: 'Transferencia a Juan' }), { categories: cats, rules })
    expect(p.status).toBe('none')
    expect(p.categoryId).toBeNull()
    expect(p.reason).toMatch(/Ninguna regla/)
    expect(p.needsConfirmation).toBe(true)
  })

  it('la prioridad decide entre reglas que coinciden', () => {
    const r1 = rule('amazon', ropa, { priority: 10 })
    const r2 = rule('amazon prime', subs, { priority: 90 })
    const ev = evaluateRules([r1, r2], mov({ description: 'Amazon Prime anual' }), cats)
    expect(ev.status).toBe('matched')
    if (ev.status === 'matched') {
      expect(ev.categoryId).toBe(subs.id)
      expect(ev.others.map((r) => r.id)).toEqual([r1.id])
    }
  })

  it('a igual prioridad gana la regla más específica', () => {
    const general = rule('amazon', ropa)
    const specific = rule('amazon prime', subs, { match: 'word' })
    const ev = evaluateRules([general, specific], mov({ description: 'AMAZON PRIME' }), cats)
    expect(ev.status === 'matched' && ev.categoryId).toBe(subs.id)
  })

  it('reglas contradictorias con la misma prioridad y especificidad producen un resultado ambiguo', () => {
    const a = rule('cafe', food)
    const b = rule('cafe', ocio)
    for (const order of [
      [a, b],
      [b, a],
    ]) {
      const ev = evaluateRules(order, mov({ description: 'Café Central' }), cats)
      expect(ev.status).toBe('ambiguous')
      if (ev.status === 'ambiguous') expect(ev.reason).toMatch(/misma prioridad/)
    }
  })

  it('varias reglas que coinciden con la misma categoría no son conflicto', () => {
    const ev = evaluateRules([rule('mercadona', food), rule('mercadona', food, { match: 'word' })], mov({ description: 'Mercadona' }), cats)
    expect(ev.status).toBe('matched')
  })

  it('el resultado no depende del orden de las reglas', () => {
    const rs = [rule('a', food, { priority: 3 }), rule('ab', ocio, { priority: 3 }), rule('abc', ropa, { priority: 1 })]
    const m = mov({ description: 'abc' })
    const results = [rs, [...rs].reverse(), [rs[1], rs[2], rs[0]]].map((order) => evaluateRules(order, m, cats))
    for (const r of results) expect(r.status === 'matched' && r.categoryId).toBe(ocio.id)
    expect([...rs].sort(compareRules).map((r) => r.id)).toEqual([...rs].reverse().sort(compareRules).map((r) => r.id))
  })

  it('ignora reglas inactivas', () => {
    const ev = evaluateRules([rule('zara', ropa, { active: false })], mov({ description: 'Zara' }), cats)
    expect(ev.status).toBe('none')
  })

  it('no asigna categorías archivadas aunque la regla coincida', () => {
    const ev = evaluateRules([rule('gym', viejo)], mov({ description: 'Gym mensual' }), cats)
    expect(ev.status).toBe('none')
    if (ev.status === 'none') {
      expect(ev.skipped).toHaveLength(1)
      expect(ev.reason).toMatch(/archivada/)
    }
  })

  it('no asigna una categoría de ingresos a un gasto', () => {
    const ev = evaluateRules([rule('empresa', nomina)], mov({ description: 'Empresa SA', kind: 'expense' }), cats)
    expect(ev.status).toBe('none')
    const ok = evaluateRules([rule('empresa', nomina)], mov({ description: 'Empresa SA', kind: 'income' }), cats)
    expect(ok.status).toBe('matched')
  })

  it('las excepciones y condiciones restringen la regla', () => {
    const r = rule('amazon', ropa, { exceptions: ['prime'], conditions: { minCents: 1000, kinds: ['expense'] } })
    expect(ruleMatches(r, mov({ description: 'Amazon pedido', amountCents: 2000 }))).toBe(true)
    expect(ruleMatches(r, mov({ description: 'Amazon Prime', amountCents: 2000 }))).toBe(false)
    expect(ruleMatches(r, mov({ description: 'Amazon pedido', amountCents: 500 }))).toBe(false)
    expect(ruleMatches(r, mov({ description: 'Amazon pedido', amountCents: 2000, kind: 'refund' }))).toBe(false)
  })

  it('puede detectar por método de pago', () => {
    const r = rule('bizum', ocio, { field: 'paymentMethod', match: 'equals' })
    expect(ruleMatches(r, mov({ description: 'Cena', paymentMethod: 'Bizum' }))).toBe(true)
  })

  it('repara reglas cuyo ID de categoría ya no existe usando el nombre guardado', () => {
    const r = rule('mercadona', food, { categoryId: 'implicit:alimentacion' })
    const ev = evaluateRules([r], mov({ description: 'Mercadona' }), cats)
    expect(ev.status === 'matched' && ev.categoryId).toBe(food.id)
  })
})

describe('validación y conflictos de reglas', () => {
  it('valida los campos', () => {
    expect(validateRule(rule('', food), cats).pattern).toBeDefined()
    expect(validateRule(rule('x', viejo), cats).categoryId).toMatch(/archivada/)
    expect(validateRule(rule('x', food, { priority: -1 }), cats).priority).toBeDefined()
    expect(validateRule(rule('x', food, { conditions: { minCents: 500, maxCents: 100 } }), cats).amount).toBeDefined()
    expect(validateRule(rule('x', food), cats)).toEqual({})
  })

  it('detecta contradicciones y duplicados', () => {
    const conflicts = detectConflicts([rule('cafe', food), rule('café', ocio), rule('zara', ropa), rule('zara', ropa)])
    expect(conflicts.map((c) => c.kind).sort()).toEqual(['contradiction', 'duplicate'])
  })

  it('no informa conflicto si las prioridades difieren', () => {
    expect(detectConflicts([rule('cafe', food, { priority: 10 }), rule('cafe', ocio, { priority: 20 })])).toHaveLength(0)
  })

  it('descarta reglas mal formadas al leer el documento', () => {
    const { rules, discarded } = parseRulesDocument({
      version: 1,
      rules: [rule('ok', food), { id: 'x' }, rule('dup', food, { id: 'same' }), rule('dup2', food, { id: 'same' }), { ...rule('m', food), match: 'regex' }],
    })
    expect(rules.map((r) => r.pattern)).toEqual(['ok', 'dup'])
    expect(discarded).toBe(3)
    expect(parseRulesDocument(null)).toEqual({ rules: [], discarded: 0 })
  })
})

describe('aprendizaje a partir de correcciones', () => {
  it('propone la primera palabra significativa', () => {
    expect(suggestPattern('COMPRA TARJ. MERCADONA 4532 MADRID')).toBe('tarj')
    expect(suggestPattern('Pago en Mercadona')).toBe('mercadona')
    expect(suggestPattern('Spotify P1234ABC')).toBe('spotify')
    expect(suggestPattern('12/10 345')).toBe('12/10 345')
  })
})

describe('pipeline con proveedor de IA (futuro)', () => {
  const ctx = { categories: cats, rules: [rule('mercadona', food)] }

  it('las reglas tienen prioridad: no se consulta a la IA si hay coincidencia', async () => {
    let called = false
    const ai: ClassificationProvider = { id: 'ai', label: 'IA', suggest: async () => ((called = true), null) }
    const p = await new ClassificationPipeline(ai).classify(mov({ description: 'Mercadona' }), ctx)
    expect(p.source).toBe('rule')
    expect(called).toBe(false)
  })

  it('valida la propuesta de la IA y exige confirmación', async () => {
    const ai: ClassificationProvider = { id: 'ai', label: 'IA local', suggest: async () => ({ categoryId: ocio.id, confidence: 0.95, reason: 'parece ocio' }) }
    const p = await new ClassificationPipeline(ai).classify(mov({ description: 'Bolera' }), ctx)
    expect(p).toMatchObject({ status: 'proposed', source: 'ai', categoryId: ocio.id, confidence: 'high', needsConfirmation: true })
  })

  it('rechaza categorías inexistentes, archivadas o incompatibles propuestas por la IA', () => {
    for (const categoryId of ['no-existe', viejo.id, nomina.id]) {
      const p = validateSuggestion(mov({ description: 'x' }), { categoryId, confidence: 0.99, reason: '' }, ctx, 'IA')
      expect(p.status).toBe('none')
      expect(p.categoryId).toBeNull()
    }
  })

  it('un proveedor que falla no bloquea la clasificación', async () => {
    const ai: ClassificationProvider = {
      id: 'ai',
      label: 'IA',
      suggest: async () => {
        throw new Error('Ollama no está instalado')
      },
    }
    const p = await new ClassificationPipeline(ai).classify(mov({ description: 'Bolera' }), ctx)
    expect(p.status).toBe('none')
  })
})
