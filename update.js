#!/usr/bin/env node
/**
 * update.js — fetch new OHLCV bars from MeroLagani and append to JSON files.
 * Run daily via GitHub Actions after NEPSE market close.
 */

const https = require('https')
const fs = require('fs')
const path = require('path')

const OHLCV_DIR = path.join(__dirname, 'ohlcv')
const INDEX_DIR = path.join(__dirname, 'index')
const SECTOR_DIR = path.join(__dirname, 'sector')

// Index symbols: filename → MeroLagani symbol
const INDEX_MAP = {
  'NEPSE.json': 'NEPSE',
  'BANKING.json': 'BANKING',
  'DEVELOPMENT_BANK.json': 'DEVELOPMENT BANK',
  'FINANCE.json': 'FINANCE',
  'HYDROPOWER.json': 'HYDROPOWER',
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://merolagani.com/',
        'X-Requested-With': 'XMLHttpRequest',
      }
    }, res => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try { resolve(JSON.parse(data)) } catch { resolve(null) }
      })
    })
    req.on('error', reject)
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')) })
  })
}

async function fetchBarsFrom(symbol, fromDate) {
  const start = Math.floor(new Date(fromDate).getTime() / 1000)
  const end = Math.floor(Date.now() / 1000)

  const url = `https://merolagani.com/handlers/TechnicalChartHandler.ashx` +
    `?type=get_advanced_chart&symbol=${encodeURIComponent(symbol)}&resolution=1D` +
    `&rangeStartDate=${start}&rangeEndDate=${end}&isAdjust=1&currencyCode=NPR`

  const data = await fetchJson(url)
  if (!data || data.s === 'no_data' || !data.t || data.t.length === 0) return []

  return data.t.map((ts, i) => ({
    date: new Date(ts * 1000).toISOString().split('T')[0],
    o: data.o[i],
    h: data.h[i],
    l: data.l[i],
    c: data.c[i],
    v: data.v[i],
  }))
}

async function updateFile(filePath, merolaganiSymbol) {
  let existing = []
  try { existing = JSON.parse(fs.readFileSync(filePath, 'utf8')) } catch { existing = [] }

  // Fetch from day after last date
  const lastDate = existing.length > 0 ? existing[existing.length - 1].date : '2019-01-01'
  const nextDate = new Date(new Date(lastDate).getTime() + 86400000).toISOString().split('T')[0]
  const today = new Date().toISOString().split('T')[0]

  if (nextDate >= today) return 0 // already up to date

  let newBars
  try {
    newBars = await fetchBarsFrom(merolaganiSymbol, nextDate)
  } catch (e) {
    console.warn(`  WARN ${merolaganiSymbol}: ${e.message}`)
    return 0
  }

  if (newBars.length === 0) return 0

  // Deduplicate by date (in case of overlap)
  const existingDates = new Set(existing.map(b => b.date))
  const toAdd = newBars.filter(b => !existingDates.has(b.date))
  if (toAdd.length === 0) return 0

  const merged = [...existing, ...toAdd].sort((a, b) => a.date < b.date ? -1 : 1)
  fs.writeFileSync(filePath, JSON.stringify(merged))
  return toAdd.length
}

async function main() {
  let totalAdded = 0
  let filesUpdated = 0

  // Update stock OHLCV files
  const stockFiles = fs.readdirSync(OHLCV_DIR).filter(f => f.endsWith('.json'))
  console.log(`Updating ${stockFiles.length} stock files...`)

  for (let i = 0; i < stockFiles.length; i++) {
    const file = stockFiles[i]
    // Reverse safeName: _ back to / only for known bond symbols (skip — just use _ as symbol)
    const symbol = path.basename(file, '.json').replace(/_/g, ' ').trim()
    // Try with underscores as-is first (most symbols are clean alpha)
    const symbolClean = path.basename(file, '.json')

    const filePath = path.join(OHLCV_DIR, file)
    const added = await updateFile(filePath, symbolClean)
    if (added > 0) {
      filesUpdated++
      totalAdded += added
      console.log(`  ${symbolClean}: +${added} bars`)
    }

    if ((i + 1) % 10 === 0) process.stdout.write(`\r  Progress: ${i + 1}/${stockFiles.length}`)
    await sleep(1200) // ~1.2s delay to avoid rate limiting
  }
  console.log(`\n  Stocks done. ${filesUpdated} files updated, ${totalAdded} new bars.`)

  // Update index files
  console.log('Updating index files...')
  for (const [file, symbol] of Object.entries(INDEX_MAP)) {
    const filePath = path.join(INDEX_DIR, file)
    if (!fs.existsSync(filePath)) continue
    const added = await updateFile(filePath, symbol)
    if (added > 0) console.log(`  ${symbol}: +${added} bars`)
    await sleep(1200)
  }

  console.log(`\nDone. Total new bars: ${totalAdded}`)
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
