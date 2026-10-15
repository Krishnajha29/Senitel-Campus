import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiService } from '../services/api';
import { LocalDatabase } from '../services/localDb';

describe('Shared Mobile QR Session Contract & API Integration', () => {
  let testClassId: string;
  let testSessionId: string;

  beforeEach(async () => {
    localStorage.clear();
    LocalDatabase.resetToEmpty();

    const testClass = LocalDatabase.createClass({
      name: 'Advanced Systems Programming',
      code: 'CS402',
      academic_year: '2026-2027',
      section: 'A',
      programme: 'B.Tech Software Engineering',
      batch: '2024-2028',
      enrollment_type: 'section',
    });
    testClassId = testClass.id;

    const session = LocalDatabase.createAttendanceSession({
      class_id: testClassId,
      title: 'Lecture 1: Kernel Architecture',
      session_date: '2026-10-15',
      start_time: '09:00',
      end_time: '10:00',
    });
    testSessionId = session.id;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves the candidate mobile API base URL properly', () => {
    const url = ApiService.getMobileApiBaseUrl();
    expect(url).toBeDefined();
    expect(typeof url).toBe('string');
    expect(url.startsWith('http://') || url.startsWith('https://')).toBe(true);
  });

  it('generates a valid shared mobile QR session contract when remote backend responds', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        session: {
          id: 'dash_qr_123',
          token: '8F3C1A2E',
          classId: testClassId,
          sessionId: testSessionId,
          courseCode: 'CS402',
          checkpointType: 'checkpoint_1',
          expiresAt: new Date(Date.now() + 600000).toISOString(),
        },
        qrPayload: JSON.stringify({
          app: 'SentinelCampus',
          token: '8F3C1A2E',
          classId: testClassId,
          sessionId: testSessionId,
          courseCode: 'CS402',
          checkpointType: 'checkpoint_1',
          expiresAt: new Date(Date.now() + 600000).toISOString(),
        }),
      }),
    } as any);

    const result = await ApiService.createSharedMobileQRSession(testSessionId, 'checkpoint_1', 10);

    expect(result).toBeDefined();
    expect(result.token).toBe('8F3C1A2E');
    expect(result.qrPayload).toBeDefined();
    expect(result.qrDataUrl).toBeDefined();
    expect(result.qrDataUrl.startsWith('data:image/png;base64,')).toBe(true);

    const payload = JSON.parse(result.qrPayload);
    expect(payload.app).toBe('SentinelCampus');
    expect(payload.token).toBe('8F3C1A2E');
    expect(payload.classId).toBe(testClassId);
    expect(payload.sessionId).toBe(testSessionId);
  });

  it('generates a resilient local session fallback if remote backend fails', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('Network error'));

    const result = await ApiService.createSharedMobileQRSession(testSessionId, 'checkpoint_1', 10);

    expect(result).toBeDefined();
    expect(result.token).toBeDefined();
    expect(result.token.length).toBe(8);
    expect(result.qrPayload).toBeDefined();
    expect(result.qrDataUrl).toBeDefined();

    const payload = JSON.parse(result.qrPayload);
    expect(payload.app).toBe('SentinelCampus');
    expect(payload.token).toBe(result.token);
    expect(payload.classId).toBe(testClassId);
    expect(payload.sessionId).toBe(testSessionId);
  });

  it('safely polls session status from remote backend', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        stats: {
          totalStudents: 30,
          identifiedCount: 5,
          pendingCount: 1,
          rejectedCount: 0,
          notCapturedCount: 25,
        },
        recentCaptures: [],
        rosterBreakdown: [],
      }),
    } as any);

    const status = await ApiService.getSharedMobileQRSessionStatus('8F3C1A2E');
    expect(status).not.toBeNull();
    expect(status?.stats.identifiedCount).toBe(5);
  });

  it('safely handles mobile session closure', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    } as any);

    const closed = await ApiService.closeSharedMobileQRSession('8F3C1A2E');
    expect(closed).toBe(true);
  });
});
