import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url')
  if (!url) return NextResponse.json({ title: null }, { status: 400 })

  try {
    // YouTube: oEmbed returns the actual video title
    if (/(?:youtube\.com\/watch|youtu\.be\/)/.test(url)) {
      const res = await fetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
      )
      if (res.ok) {
        const data = await res.json()
        if (data.title) return NextResponse.json({ title: data.title })
      }
    }

    // Generic: fetch HTML and extract title
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FloNotes/1.0)' },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return NextResponse.json({ title: null })

    const html = await res.text()

    // Try og:title first (both attribute orderings)
    const ogMatch =
      html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ??
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)
    if (ogMatch?.[1]) return NextResponse.json({ title: ogMatch[1].trim() })

    // Fall back to <title>
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
    if (titleMatch?.[1]) return NextResponse.json({ title: titleMatch[1].trim() })

    return NextResponse.json({ title: null })
  } catch {
    return NextResponse.json({ title: null })
  }
}
