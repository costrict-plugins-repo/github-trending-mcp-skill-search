// Requires `npm run build` to have populated dist/. The test runner does not
// auto-build — keep build as an explicit step in CI / local before testing.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST_INDEX = path.resolve(__dirname, '..', 'dist', 'index.js')

const builtFlag = fs.existsSync(DIST_INDEX)
const describeFn = builtFlag ? describe : describe.skip

// ---------------------------------------------------------------------------
// Framing helpers — MCP stdio uses newline-delimited JSON (NDJSON)
// ---------------------------------------------------------------------------

function frame(message: object): string {
  return JSON.stringify(message) + '\n'
}

/**
 * Find the JSON content block in a tools/call response.
 * The server may prepend a [ACTION REQUIRED] notice block before the JSON
 * when SLASH_COMMAND_TOOL_CHAR_BUDGET is unset; the JSON is always the
 * trailing block (last text block whose content starts with `{`).
 */
function jsonBlock(content: Array<{ type: string; text: string }>): string {
  for (let i = content.length - 1; i >= 0; i--) {
    const t = content[i]?.text ?? ''
    if (t.trimStart().startsWith('{')) return t
  }
  throw new Error('no JSON block found in tools/call response')
}

function readResponse(child: ChildProcessWithoutNullStreams): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let buffer = ''
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('utf-8')
      const newlineIdx = buffer.indexOf('\n')
      if (newlineIdx === -1) return
      const line = buffer.slice(0, newlineIdx).trim()
      buffer = buffer.slice(newlineIdx + 1)
      if (!line) return
      child.stdout.off('data', onData)
      try {
        resolve(JSON.parse(line))
      } catch (e) {
        reject(e)
      }
    }
    child.stdout.on('data', onData)
    setTimeout(() => {
      child.stdout.off('data', onData)
      reject(new Error('timeout waiting for response'))
    }, 5000)
  })
}

// ---------------------------------------------------------------------------
// Integration suite — requires dist/index.js
// ---------------------------------------------------------------------------

describeFn('integration: stdio MCP server', () => {
  let child: ChildProcessWithoutNullStreams

  beforeAll(async () => {
    if (!builtFlag) return // suite is skipped anyway

    const fixturesDir = path.resolve(__dirname, 'fixtures', 'skills')
    child = spawn('node', [DIST_INDEX], {
      env: { ...process.env, SKILL_PATHS: fixturesDir },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    // Drain stderr to keep buffer from filling
    child.stderr.on('data', () => {})

    // Initialize handshake
    child.stdin.write(frame({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'integration-test', version: '0.0.1' },
      },
    }))
    await readResponse(child)

    // Send initialized notification (no response expected)
    child.stdin.write(frame({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    }))
  })

  afterAll(() => {
    if (child && !child.killed) {
      child.kill('SIGTERM')
    }
  })

  it('lists the skill_search tool with alwaysLoad meta', async () => {
    child.stdin.write(frame({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
    }))
    const response = await readResponse(child) as any
    expect(response.id).toBe(2)
    expect(response.result.tools).toHaveLength(1)
    const tool = response.result.tools[0]
    expect(tool.name).toBe('skill_search')
    expect(tool._meta).toEqual({ 'anthropic/alwaysLoad': true })
  })

  it('returns auto-go for select:auto-go', async () => {
    child.stdin.write(frame({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'skill_search',
        arguments: { query: 'select:auto-go' },
      },
    }))
    const response = await readResponse(child) as any
    expect(response.id).toBe(3)
    const text = jsonBlock(response.result.content)
    const parsed = JSON.parse(text)
    expect(parsed.matches).toHaveLength(1)
    expect(parsed.matches[0].name).toBe('auto-go')
    expect(parsed.matches[0].description).toContain('Autonomous orchestrator')
    expect(parsed.query).toBe('select:auto-go')
    expect(parsed.total_skills).toBeGreaterThanOrEqual(4)
  })

  it('ranks deploy-related skills for query "deploy"', async () => {
    child.stdin.write(frame({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'skill_search',
        arguments: { query: 'deploy', max_results: 5 },
      },
    }))
    const response = await readResponse(child) as any
    const parsed = JSON.parse(jsonBlock(response.result.content))
    expect(parsed.matches.length).toBeGreaterThan(0)
    // ship-to-prod has triggers including "deploy" and description with "deploy"
    expect(parsed.matches.some((m: any) => m.name === 'ship-to-prod')).toBe(true)
  })

  it('respects +required term filter', async () => {
    child.stdin.write(frame({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'skill_search',
        arguments: { query: '+nonexistent foo' },
      },
    }))
    const response = await readResponse(child) as any
    const parsed = JSON.parse(jsonBlock(response.result.content))
    expect(parsed.matches).toEqual([])
  })

  it('returns an error for missing query', async () => {
    child.stdin.write(frame({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: {
        name: 'skill_search',
        arguments: {}, // missing query
      },
    }))
    const response = await readResponse(child) as any
    // The MCP SDK formats handler errors as either error or as content with isError: true
    // Accept either shape:
    const isError =
      response.error !== undefined ||
      (response.result?.isError === true) ||
      (response.result?.content?.[0]?.text && /[Ii]nvalid/.test(response.result.content[0].text))
    expect(isError).toBe(true)
  })
})
