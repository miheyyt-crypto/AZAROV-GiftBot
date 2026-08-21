import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  assertSafeScreenshot,
  createSubmissionId,
  detectImageType,
  isForbiddenOriginalName,
  resolveSubmissionScreenshotPath,
  saveSubmissionScreenshot,
  deleteSubmissionScreenshot,
  UPLOADS_ROOT,
} from './uploads.mjs'

function pngBuffer() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  )
}

test('detectImageType recognizes png and rejects svg/html/exe/zip', () => {
  assert.equal(detectImageType(pngBuffer())?.ext, 'png')
  assert.equal(detectImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null)
  assert.equal(detectImageType(Buffer.from('<!DOCTYPE html><html></html>')), null)
  assert.equal(detectImageType(Buffer.from('MZ\x90\x00fakeexe')), null)
  assert.equal(detectImageType(Buffer.from('PK\x03\x04zip')), null)
  assert.equal(detectImageType(Buffer.from('#!/bin/sh\necho hi\n')), null)
})

test('forbidden original names are rejected', () => {
  assert.equal(isForbiddenOriginalName('photo.exe'), true)
  assert.equal(isForbiddenOriginalName('x.svg'), true)
  assert.equal(isForbiddenOriginalName('a.html'), true)
  assert.equal(isForbiddenOriginalName('script.js'), true)
  assert.equal(isForbiddenOriginalName('pack.zip'), true)
  assert.equal(isForbiddenOriginalName('ok.png'), false)
})

test('assertSafeScreenshot enforces 5MB and magic bytes', () => {
  assert.equal(assertSafeScreenshot(pngBuffer()).ok, true)
  assert.equal(assertSafeScreenshot(Buffer.alloc(0)).ok, false)
  assert.equal(assertSafeScreenshot(Buffer.alloc(5 * 1024 * 1024 + 1)).ok, false)
  assert.equal(assertSafeScreenshot(Buffer.from('<svg></svg>'), 'image/svg+xml', 'x.svg').ok, false)
})

test('path resolver blocks traversal variants', () => {
  assert.equal(resolveSubmissionScreenshotPath('../secret.png'), null)
  assert.equal(resolveSubmissionScreenshotPath('..\\secret.png'), null)
  assert.equal(resolveSubmissionScreenshotPath('partner-submissions/../../etc/passwd'), null)
  assert.equal(resolveSubmissionScreenshotPath('partner-submissions/%2e%2e/%2e%2e/etc/passwd'), null)
  assert.equal(resolveSubmissionScreenshotPath('partner-submissions/not-a-uuid.jpg'), null)
  assert.equal(resolveSubmissionScreenshotPath('/etc/passwd'), null)
})

test('save uses submissionId.ext only and resolves safely', () => {
  const id = createSubmissionId()
  const saved = saveSubmissionScreenshot(id, pngBuffer(), 'png')
  assert.equal(saved.fileName, `${id}.png`)
  assert.equal(saved.relativePath, `partner-submissions/${id}.png`)
  assert.equal(existsSync(saved.absolutePath), true)

  const resolved = resolveSubmissionScreenshotPath(saved.relativePath)
  assert.equal(resolved, saved.absolutePath)

  assert.equal(deleteSubmissionScreenshot(saved.relativePath), true)
  assert.equal(existsSync(saved.absolutePath), false)
})

test('uploads root is outside public/', () => {
  assert.equal(UPLOADS_ROOT.includes(`${path.sep}public${path.sep}`), false)
  assert.ok(UPLOADS_ROOT.replace(/\\/g, '/').endsWith('uploads/partner-submissions') || UPLOADS_ROOT.endsWith(path.join('uploads', 'partner-submissions')))
})
