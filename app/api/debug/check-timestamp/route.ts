import { NextResponse } from 'next/server';
import { getMetadata } from '@/lib/db';

export async function GET() {
  try {
    const driveSync = await getMetadata('drive_last_sync');
    const figmaSync = await getMetadata('figma_last_sync');
    const jiraSync = await getMetadata('jira_last_sync');
    
    return NextResponse.json({
      success: true,
      timestamps: {
        drive: driveSync || 'null',
        figma: figmaSync || 'null',
        jira: jiraSync || 'null'
      }
    });
  } catch (error: any) {
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}

