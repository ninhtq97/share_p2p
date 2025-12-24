import { NextResponse } from 'next/server';

type PeerEntry = {
  peerId: string;
  name: string;
  updatedAt: number;
};

type Registry = Map<string, Map<string, PeerEntry>>;

declare global {
  var __roomRegistry: Registry | undefined;
}

const registry: Registry = globalThis.__roomRegistry || new Map();
globalThis.__roomRegistry = registry;

const pruneRoom = (roomId: string) => {
  const roomPeers = registry.get(roomId);
  if (!roomPeers) return;

  const now = Date.now();
  roomPeers.forEach((entry, key) => {
    if (now - entry.updatedAt > 1000 * 60 * 60) {
      roomPeers.delete(key);
    }
  });

  if (roomPeers.size === 0) {
    registry.delete(roomId);
  }
};

export async function GET(
  _: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  const { roomId } = await params;
  pruneRoom(roomId);
  const peers = Array.from(registry.get(roomId)?.values() ?? []);
  return NextResponse.json({ peers });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  const { roomId } = await params;
  const { peerId, name } = (await req.json()) as {
    peerId?: string;
    name?: string;
  };

  if (!peerId || !name) {
    return NextResponse.json(
      { error: 'peerId and name are required' },
      { status: 400 },
    );
  }

  const roomPeers = registry.get(roomId) ?? new Map<string, PeerEntry>();
  roomPeers.set(peerId, { peerId, name, updatedAt: Date.now() });
  registry.set(roomId, roomPeers);

  const peers = Array.from(roomPeers.values());
  return NextResponse.json({ peers });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  const { roomId } = await params;
  const { peerId } = (await req.json()) as { peerId?: string };

  if (!peerId) {
    return NextResponse.json({ error: 'peerId is required' }, { status: 400 });
  }

  const roomPeers = registry.get(roomId);
  if (roomPeers) {
    roomPeers.delete(peerId);
    if (roomPeers.size === 0) {
      registry.delete(roomId);
    }
  }

  const peers = Array.from(registry.get(roomId)?.values() ?? []);
  return NextResponse.json({ peers });
}
