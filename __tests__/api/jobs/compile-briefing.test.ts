import { compileNycBriefing } from '@/lib/compile-briefing';

jest.mock('@/lib/db', () => ({
  __esModule: true,
  default: {
    alertEvent: { findMany: jest.fn().mockResolvedValue([]) },
    cityEvent: { findMany: jest.fn().mockResolvedValue([]) },
    newsArticle: { findMany: jest.fn().mockResolvedValue([]) },
    suspensionEvent: { findMany: jest.fn().mockResolvedValue([]) },
    airQualityReading: { findMany: jest.fn().mockResolvedValue([]) },
    serviceAlert: { findMany: jest.fn().mockResolvedValue([]) },
    diningDeal: { findMany: jest.fn().mockResolvedValue([]) },
    parkEvent: { findMany: jest.fn().mockResolvedValue([]) },
    compiledBriefing: { create: jest.fn().mockResolvedValue({ id: 'test' }) },
  },
}));

describe('compileNycBriefing', () => {
  it('returns a payload with all expected top-level keys', async () => {
    const result = await compileNycBriefing();
    expect(result).toHaveProperty('city', 'nyc');
    expect(result).toHaveProperty('version', '1.0');
    expect(result).toHaveProperty('generatedAt');
    expect(result).toHaveProperty('transit');
    expect(result).toHaveProperty('parking');
    expect(result).toHaveProperty('events');
    expect(result).toHaveProperty('dining');
    expect(result).toHaveProperty('news');
    expect(result).toHaveProperty('serviceAlerts');
    expect(result).toHaveProperty('parks');
    expect(result).toHaveProperty('airQuality');
  });

  it('saves the compiled briefing to the database', async () => {
    const db = (await import('@/lib/db')).default;
    await compileNycBriefing();
    expect(db.compiledBriefing.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        city: 'nyc',
        version: '1.0',
        payload: expect.any(Object),
      }),
    });
  });
});
