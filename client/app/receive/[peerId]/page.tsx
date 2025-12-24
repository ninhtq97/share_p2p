import Receiver from '@/components/Receiver';

type ReceivePageProps = {
  params: Promise<{ peerId: string }>;
};

const ReceivePage: React.FC<ReceivePageProps> = async ({ params }) => {
  const { peerId } = await params;

  return (
    <div className="flex h-screen w-full items-center justify-center">
      <Receiver remotePeerId={peerId} />
    </div>
  );
};

export default ReceivePage;
