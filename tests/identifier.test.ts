import { describe, it, expect } from 'vitest'
import { pickBestMatch, titleAffinity, TITLE_SCORE } from '../src/main/tmdb/identifier'
import { cleanTitle } from '../src/main/scanner/name-parser'

interface Raw {
  id: number
  title?: string
  original_title?: string
  release_date?: string
  popularity?: number
}

describe('pickBestMatch — no acepta un título que no se parece', () => {
  it('rechaza resultados irrelevantes aunque coincida el año (caso "300")', () => {
    // TMDB devuelve esto al buscar "300" con primary_release_year=2006, porque la
    // película real se estrenó en 2007. Ninguno debe aceptarse.
    const results: Raw[] = [
      { id: 1, title: 'Home Movies 300-1', release_date: '2006-01-01', popularity: 0.4 },
      { id: 2, title: 'Video 3000', release_date: '2006-05-01', popularity: 0.44 },
      { id: 3, title: '3001 Kosmine Odiseja', release_date: '2006-03-01', popularity: 0.3 }
    ]
    expect(pickBestMatch(results, '300', 2006)).toBeNull()
  })

  it('acepta la coincidencia exacta aunque el año no cuadre', () => {
    const results: Raw[] = [{ id: 1929, title: '300', release_date: '2007-03-07', popularity: 40 }]
    const best = pickBestMatch(results, '300', 2006)
    expect(best?.raw.id).toBe(1929)
    expect(best?.titleScore).toBe(TITLE_SCORE.exact)
  })

  it('el año no puede rescatar por sí solo un título sin parecido ni relevancia', () => {
    // Popularidad tomada de la respuesta real de TheMovieDB para esta búsqueda: lo que
    // devuelve un filtro de año equivocado es material marginal, y eso es justo lo que
    // distingue esta basura de un acierto legítimo por título alternativo.
    const results: Raw[] = [
      { id: 7, title: '2 Ladrones Y Medio', release_date: '2006-01-01', popularity: 0.5 }
    ]
    expect(pickBestMatch(results, '300', 2006)).toBeNull()
  })

  it('prefiere el resultado cuyo año coincide entre dos títulos exactos', () => {
    const results: Raw[] = [
      { id: 1, title: 'Avatar', release_date: '2004-01-01', popularity: 5 },
      { id: 2, title: 'Avatar', release_date: '2009-12-18', popularity: 5 }
    ]
    expect(pickBestMatch(results, 'Avatar', 2009)?.raw.id).toBe(2)
  })

  it('acepta coincidencia parcial contenida (título con prefijo extra)', () => {
    const results: Raw[] = [
      { id: 10, title: 'El muñeco diabólico', release_date: '1988-11-09', popularity: 20 }
    ]
    const best = pickBestMatch(results, 'Chucky El Muñeco Diabólico', 1988)
    expect(best?.raw.id).toBe(10)
    // Contención amplia: puntúa alto, pero por debajo de una coincidencia exacta.
    expect(best!.titleScore).toBeGreaterThan(70)
    expect(best!.titleScore).toBeLessThan(TITLE_SCORE.exact)
  })

  it('compara ignorando acentos y puntuación', () => {
    const results: Raw[] = [
      { id: 11, title: '2001: Odisea del Espacio', release_date: '1968-04-02', popularity: 30 }
    ]
    const best = pickBestMatch(results, '2001 odisea del espacio', 1968)
    expect(best?.titleScore).toBe(TITLE_SCORE.exact)
  })

  it('usa el título original cuando el traducido no coincide', () => {
    const results: Raw[] = [
      { id: 12, title: 'Mi Pobre Angelito', original_title: 'Home Alone', release_date: '1990-11-16' }
    ]
    expect(pickBestMatch(results, 'Home Alone', 1990)?.raw.id).toBe(12)
  })

  it('lista vacía devuelve null', () => {
    expect(pickBestMatch([], 'lo que sea', 2000)).toBeNull()
  })
})

describe('normalización Unicode de macOS (NFD)', () => {
  // macOS entrega los nombres de archivo con los acentos descompuestos: la "í" llega
  // como "i" + tilde combinante. Sin recomponer, TheMovieDB no encuentra nada.
  // Se descompone explícitamente para que la prueba sea real sin depender de cómo se
  // haya guardado este archivo fuente.
  const nfdName = 'Ah\u00ed est\u00e1 el detalle (1940).mpg'.normalize('NFD')

  it('el nombre de prueba realmente está en NFD', () => {
    expect(nfdName).not.toBe(nfdName.normalize('NFC'))
  })

  it('cleanTitle devuelve el título en NFC', () => {
    const result = cleanTitle(nfdName)
    expect(result.title).toBe('Ahí está el detalle')
    expect(result.title).toBe(result.title.normalize('NFC'))
    expect(result.year).toBe(1940)
  })

  it('el título recompuesto coincide con el de TMDB', () => {
    const { title, year } = cleanTitle(nfdName)
    const results: Raw[] = [
      { id: 43904, title: 'Ahí está el detalle', release_date: '1940-09-13', popularity: 8 }
    ]
    expect(pickBestMatch(results, title, year)?.raw.id).toBe(43904)
  })

  it('otros títulos acentuados del NAS también se recomponen', () => {
    expect(cleanTitle('Drácula (1992).mp4').title).toBe('Drácula')
    expect(cleanTitle('Días Perfectos (2023).mkv').title).toBe('Días Perfectos')
    expect(cleanTitle('El código Da Vinci (2006).avi').title).toBe('El código Da Vinci')
  })
})

describe('vía débil: primer resultado de TMDB cuando el título localizado difiere', () => {
  it('acepta el primer resultado si el año coincide y es una obra conocida', () => {
    // El archivo se llama "Korra"; TheMovieDB la titula "La leyenda de Korra".
    const results: Raw[] = [
      { id: 60622, title: 'La leyenda de Korra', release_date: '2012-04-14', popularity: 45 }
    ]
    const best = pickBestMatch(results, 'Korra', 2012)
    expect(best?.raw.id).toBe(60622)
    expect(best?.titleScore).toBe(TITLE_SCORE.none)
  })

  it('NO acepta resultados irrelevantes con año correcto pero sin popularidad', () => {
    const results: Raw[] = [
      { id: 1, title: 'Home Movies 300-1', release_date: '2006-01-01', popularity: 0.4 },
      { id: 2, title: 'Video 3000', release_date: '2006-05-01', popularity: 0.44 }
    ]
    expect(pickBestMatch(results, '300', 2006)).toBeNull()
  })

  it('NO acepta la vía débil si el año no coincide', () => {
    const results: Raw[] = [
      { id: 9, title: 'Otra cosa totalmente distinta', release_date: '1999-01-01', popularity: 80 }
    ]
    expect(pickBestMatch(results, 'Korra', 2012)).toBeNull()
  })

  it('sin año, un título corto NO activa la vía débil', () => {
    const results: Raw[] = [
      { id: 9, title: 'Otra cosa totalmente distinta', release_date: '2012-01-01', popularity: 80 }
    ]
    expect(pickBestMatch(results, 'Korra', undefined)).toBeNull()
  })

  it('sin año, un título largo y distintivo sí la activa', () => {
    // Caso real: los archivos de Evangelion no llevan año y TheMovieDB los titula
    // "Evangelion: 1.11 Tú (No) Estás Solo".
    const results: Raw[] = [
      { id: 12429, title: 'Evangelion: 1.11 Tú (No) Estás Solo', release_date: '2007-09-01', popularity: 6.6 }
    ]
    const best = pickBestMatch(results, 'Evangelion 1 0 You Are (Not) Alone', undefined)
    expect(best?.raw.id).toBe(12429)
  })

  it('sin año, un título largo pero con resultado marginal NO se acepta', () => {
    const results: Raw[] = [
      { id: 5, title: 'Cualquier cosa irrelevante aqui', release_date: '2007-09-01', popularity: 0.4 }
    ]
    expect(pickBestMatch(results, 'Una Pelicula Que No Existe Aqui', undefined)).toBeNull()
  })

  it('con año que NO cuadra, la vía débil se descarta aunque sea popular', () => {
    const results: Raw[] = [
      { id: 9, title: 'Otra cosa totalmente distinta', release_date: '1999-01-01', popularity: 80 }
    ]
    expect(pickBestMatch(results, 'Korra', 2012)).toBeNull()
  })

  it('acepta una obra poco conocida si el año coincide (Turtles Can Fly)', () => {
    const results: Raw[] = [
      { id: 11168, title: 'Las tortugas también vuelan', release_date: '2004-08-13', popularity: 2.97 }
    ]
    expect(pickBestMatch(results, 'Turtles Can Fly', 2004)?.raw.id).toBe(11168)
  })

  it('una coincidencia real de título gana a la vía débil', () => {
    const results: Raw[] = [
      { id: 1, title: 'Popular pero equivocada', release_date: '2012-01-01', popularity: 99 },
      { id: 2, title: 'Korra', release_date: '2012-04-14', popularity: 5 }
    ]
    expect(pickBestMatch(results, 'Korra', 2012)?.raw.id).toBe(2)
  })
})

describe('cobertura de títulos: cuánto se solapan decide, no la dirección', () => {
  it('"The Big Bang Theory" gana a "Big Bang" para el archivo "Big Bang Theory"', () => {
    // Regresión real: la búsqueda de respaldo con el título recortado ("Big Bang")
    // devolvía "Big Bang!" y su parecido de prefijo superaba al acierto verdadero.
    const buena = titleAffinity('the big bang theory', 'big bang theory')
    const mala = titleAffinity('big bang', 'big bang theory')
    expect(buena).toBeGreaterThan(mala)
    expect(mala).toBeGreaterThan(0)
  })

  it('el primer resultado real de TMDB para la serie se elige correctamente', () => {
    const results: Raw[] = [
      { id: 1418, title: 'La Teoría del Big Bang', original_title: 'The Big Bang Theory', release_date: '2007-09-24', popularity: 50.8 },
      { id: 322995, title: 'The Official Big Bang Theory Podcast', release_date: '2026-01-01', popularity: 4.8 }
    ]
    expect(pickBestMatch(results, 'Big Bang Theory', undefined)?.raw.id).toBe(1418)
  })

  it('un solape mínimo no cuenta como parecido', () => {
    expect(titleAffinity('home movies 300 1', '300')).toBe(TITLE_SCORE.none)
  })

  it('la contención debe ser por palabras completas', () => {
    expect(titleAffinity('3001 kosmine odiseja', '300')).toBe(TITLE_SCORE.none)
  })

  it('títulos idénticos puntúan al máximo', () => {
    expect(titleAffinity('avatar', 'avatar')).toBe(TITLE_SCORE.exact)
  })
})

describe('coincidencia al inicio del título (series con nombre largo en TMDB)', () => {
  it('"Frieren" identifica "Frieren: Más allá del final del viaje"', () => {
    const score = titleAffinity('frieren mas alla del final del viaje', 'frieren')
    expect(score).toBeGreaterThanOrEqual(60)
  })

  it('"Avatar" identifica "Avatar: La leyenda de Aang"', () => {
    expect(titleAffinity('avatar la leyenda de aang', 'avatar')).toBeGreaterThanOrEqual(60)
  })

  it('pero una coincidencia en medio con poco solape sigue sin valer', () => {
    expect(titleAffinity('home movies 300 1', '300')).toBe(TITLE_SCORE.none)
  })

  it('la coincidencia amplia al final gana a la coincidencia corta al inicio', () => {
    // "The Big Bang Theory" (final, 79% de solape) debe ganar a "Big Bang" (inicio, 53%).
    expect(titleAffinity('the big bang theory', 'big bang theory')).toBeGreaterThan(
      titleAffinity('big bang', 'big bang theory')
    )
  })
})
