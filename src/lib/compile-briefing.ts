import db from '@/lib/db';

export async function compileNycBriefing() {
  const now = new Date();
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  // Query all data sources in parallel
  const [
    transitAlerts,
    cityEvents,
    newsArticles,
    suspensionEvents,
    airQuality,
    serviceAlerts,
    diningDeals,
    parkEvents,
  ] = await Promise.all([
    db.alertEvent.findMany({
      where: {
        source: { module: { id: 'transit' } },
        createdAt: { gte: todayStart },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    db.cityEvent.findMany({
      where: {
        status: 'published',
        startsAt: { gte: todayStart, lte: weekFromNow },
      },
      orderBy: [{ insiderScore: 'desc' }, { startsAt: 'asc' }],
      take: 20,
    }),
    db.newsArticle.findMany({
      where: {
        isSelected: true,
        curatedFor: todayStart,
      },
      orderBy: { publishedAt: 'desc' },
      take: 5,
    }),
    db.suspensionEvent.findMany({
      where: {
        date: { gte: todayStart },
      },
      orderBy: { date: 'asc' },
      take: 10,
      include: { city: true },
    }),
    db.airQualityReading.findMany({
      where: {
        forecastDate: todayStart,
      },
      orderBy: { aqi: 'desc' },
      take: 5,
    }),
    db.serviceAlert.findMany({
      where: {
        status: { not: 'Closed' },
        severity: { in: ['high', 'critical'] },
      },
      orderBy: { createdDate: 'desc' },
      take: 10,
    }),
    db.diningDeal.findMany({
      where: {
        isActive: true,
        OR: [
          { endDate: null },
          { endDate: { gte: todayStart } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
    db.parkEvent.findMany({
      where: {
        date: { gte: todayStart, lte: weekFromNow },
      },
      orderBy: { date: 'asc' },
      take: 10,
    }),
  ]);

  // Check if ASP is suspended today
  const todaySuspension = suspensionEvents.find(
    (e) => e.date.toISOString().split('T')[0] === todayStart.toISOString().split('T')[0]
  );

  const payload = {
    city: 'nyc',
    generatedAt: now.toISOString(),
    version: '1.0',
    transit: {
      alerts: transitAlerts.map((a) => ({
        id: a.id,
        title: a.title,
        body: a.body,
        neighborhoods: a.neighborhoods,
        startsAt: a.startsAt?.toISOString() ?? null,
        endsAt: a.endsAt?.toISOString() ?? null,
        metadata: a.metadata,
      })),
    },
    parking: {
      aspSuspended: !!todaySuspension,
      reason: todaySuspension?.summary ?? null,
      upcoming: suspensionEvents.map((e) => ({
        date: e.date.toISOString().split('T')[0],
        reason: e.summary,
      })),
    },
    events: {
      featured: cityEvents
        .filter((e) => e.insiderScore >= 70)
        .slice(0, 5)
        .map(formatCityEvent),
      today: cityEvents
        .filter((e) => {
          const eventDate = e.startsAt?.toISOString().split('T')[0];
          const today = todayStart.toISOString().split('T')[0];
          return eventDate === today;
        })
        .map(formatCityEvent),
      thisWeek: cityEvents.map(formatCityEvent),
    },
    dining: diningDeals.map((d) => ({
      id: d.id,
      restaurant: d.restaurant,
      neighborhood: d.neighborhood,
      cuisine: d.cuisine,
      dealType: d.dealType,
      title: d.title,
      description: d.description,
      price: d.price,
      startDate: d.startDate?.toISOString().split('T')[0] ?? null,
      endDate: d.endDate?.toISOString().split('T')[0] ?? null,
      url: d.url,
    })),
    news: {
      topStories: newsArticles.map((n) => ({
        id: n.id,
        title: n.title,
        source: n.source,
        summary: n.summary,
        nycAngle: n.nycAngle,
        url: n.url,
        publishedAt: n.publishedAt.toISOString(),
      })),
    },
    airQuality: airQuality.map((a) => ({
      zipCode: a.zipCode,
      aqi: a.aqi,
      category: a.category,
      pollutant: a.pollutant,
      isAlert: a.isAlert,
    })),
    serviceAlerts: serviceAlerts.map((s) => ({
      id: s.id,
      type: s.complaintType,
      descriptor: s.descriptor,
      address: s.address,
      borough: s.borough,
      severity: s.severity,
      status: s.status,
    })),
    parks: parkEvents.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      parkName: p.parkName,
      borough: p.borough,
      date: p.date.toISOString().split('T')[0],
      startTime: p.startTime,
      endTime: p.endTime,
      category: p.category,
      isFree: p.isFree,
      url: p.url,
    })),
  };

  // Save to database
  await db.compiledBriefing.create({
    data: {
      city: 'nyc',
      version: '1.0',
      payload,
    },
  });

  return payload;
}

function formatCityEvent(e: {
  id: string;
  title: string;
  description: string | null;
  category: string;
  startsAt: Date | null;
  endsAt: Date | null;
  venue: string | null;
  neighborhood: string | null;
  borough: string | null;
  insiderScore: number;
  scarcityScore: number;
  tags: string[];
}) {
  return {
    id: e.id,
    title: e.title,
    description: e.description,
    category: e.category,
    startsAt: e.startsAt?.toISOString() ?? null,
    endsAt: e.endsAt?.toISOString() ?? null,
    venue: e.venue,
    neighborhood: e.neighborhood,
    borough: e.borough,
    insiderScore: e.insiderScore,
    scarcityScore: e.scarcityScore,
    tags: e.tags,
  };
}
