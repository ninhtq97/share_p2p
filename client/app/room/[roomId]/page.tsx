import Room from '@/components/Room';

type RoomPageProps = {
  params: Promise<{ roomId: string }>;
};

const RoomPage: React.FC<RoomPageProps> = async ({ params }) => {
  const { roomId } = await params;

  return (
    <div className="flex min-h-screen w-full items-center justify-center">
      <Room roomId={roomId} />
    </div>
  );
};

export default RoomPage;
