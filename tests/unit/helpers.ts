// Shared fixtures for the unit tests: the real NumCS course graph and small state builders.
import courseJson from '../../courses/numcs/course.json'
import { CourseGraph } from '../../src/shared/graph'
import { applyEvidence, getConcept, type EvidenceInput } from '../../src/shared/mastery'
import type { AppState, Course, LearnerModel, Session } from '../../src/shared/types'

export const course = courseJson as unknown as Course
export const graph = new CourseGraph(course)

export const DAY = 86_400_000
/** Noon local time, so day keys never straddle midnight. */
export const NOW = new Date('2026-11-20T12:00:00')
export const at = (days: number, base = NOW): Date => new Date(base.getTime() + days * DAY)

export function emptyLearner(): LearnerModel {
  return { profile: [], concepts: {} }
}

export function emptyState(learner: LearnerModel = emptyLearner()): AppState {
  return {
    version: 1,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    learner,
    rewards: { total: 0, events: [] },
    calibration: [],
    sessions: [],
    activeSessionId: null
  }
}

export function makeSession(partial: Partial<Session> = {}): Session {
  return {
    id: 'sess_test',
    type: 'learn',
    goalConceptId: null,
    scope: [],
    startedAt: NOW.toISOString(),
    endedAt: null,
    phase: 'probe',
    steps: [],
    plan: null,
    currentNodeId: null,
    queue: [],
    itemsGoal: 6,
    chat: [],
    pointsEarned: 0,
    summary: null,
    ...partial
  }
}

/** Apply a list of answers to one concept in the learner model (mutates and returns the model). */
export function answer(model: LearnerModel, conceptId: string, items: Partial<EvidenceInput>[], when: Date = NOW): LearnerModel {
  let cs = getConcept(model, conceptId)
  for (const it of items) {
    const input: EvidenceInput = {
      sessionId: 'sess_test',
      kind: 'practice',
      conceptId,
      score: 1,
      hints: 0,
      attempts: 1,
      revealed: false,
      confidence: 3,
      level: 2,
      cue: 'familiar',
      summary: 'test item',
      primary: true,
      ...it
    }
    cs = applyEvidence(cs, input, when).state
  }
  model.concepts[conceptId] = cs
  return model
}
