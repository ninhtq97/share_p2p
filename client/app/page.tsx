'use client';

import { useRouter } from 'next/navigation';
import { KeyboardEvent, useState } from 'react';

import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  Divider,
  Input,
} from '@heroui/react';
import { Plus, Users } from 'lucide-react';

export default function HomePage() {
  const [roomId, setRoomId] = useState('');
  const router = useRouter();

  const createRoom = () => {
    const newRoomId = Math.random().toString(36).substring(2, 10);
    router.push(`/room/${newRoomId}`);
  };

  const joinRoom = () => {
    if (roomId.trim()) {
      router.push(`/room/${roomId.trim()}`);
    }
  };

  return (
    <div className="flex h-screen w-full items-center justify-center">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="flex-col text-center">
          <div className="mb-2 flex items-center justify-center gap-2">
            <Users className="text-primary h-10 w-10" />
            <h1 className="font-headline text-4xl tracking-tight">PeerShare</h1>
          </div>
          <p className="text-muted-foreground">
            Share files with multiple users in real-time
          </p>
        </CardHeader>
        <CardBody className="space-y-4">
          <Button
            onPress={createRoom}
            size="lg"
            color="primary"
            startContent={<Plus className="h-5 w-5" />}
          >
            Create New Room
          </Button>

          <div className="relative flex items-center justify-center py-2">
            <Divider className="absolute" />
            <Chip size="sm" variant="flat" className="bg-content1 z-10 px-3">
              or
            </Chip>
          </div>

          <div className="flex flex-col gap-3">
            <Input
              label="Room ID"
              placeholder="Enter room ID"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              onKeyDown={(e: KeyboardEvent) => e.key === 'Enter' && joinRoom()}
            />
            <Button
              onPress={joinRoom}
              size="lg"
              variant="bordered"
              isDisabled={!roomId.trim()}
            >
              Join Room
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
