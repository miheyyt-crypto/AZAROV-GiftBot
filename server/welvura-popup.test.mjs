import assert from 'node:assert/strict'
import test from 'node:test'

/**
 * Mirrors src/lib/partners.ts shouldShowWelvuraEntryPopup —
 * completed = COMPLETED, verified = PENDING.
 */
function shouldShowWelvuraEntryPopup(status) {
  const completed = status === 'COMPLETED'
  const verified = status === 'PENDING'
  return !completed && !verified
}

test('Welvura entry popup: show only when not completed and not verified', () => {
  assert.equal(shouldShowWelvuraEntryPopup('AVAILABLE'), true)
  assert.equal(shouldShowWelvuraEntryPopup('IN_PROGRESS'), true)
  assert.equal(shouldShowWelvuraEntryPopup('REJECTED'), true)
  assert.equal(shouldShowWelvuraEntryPopup('LOCKED'), true)

  assert.equal(shouldShowWelvuraEntryPopup('COMPLETED'), false)
  assert.equal(shouldShowWelvuraEntryPopup('PENDING'), false)
})
