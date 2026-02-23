import { NextRequest, NextResponse } from 'next/server';
import { compileNycBriefing } from '@/lib/compile-briefing';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const payload = await compileNycBriefing();
    return NextResponse.json({
      success: true,
      city: payload.city,
      generatedAt: payload.generatedAt,
    });
  } catch (error) {
    console.error('Compile briefing failed:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
