'use client';

import { useEffect, useRef, useState } from 'react';

import {
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Progress,
  addToast,
} from '@heroui/react';
import {
  CheckCircle2,
  Download,
  File as FileIcon,
  Loader2,
  Share2,
  XCircle,
} from 'lucide-react';
import type { DataConnection, Peer } from 'peerjs';

import { formatBytes } from '@/lib/utils';

type FileMetadata = {
  name: string;
  size: number;
  type: string;
};

type ReceiverProps = {
  remotePeerId: string;
};

type PeerData =
  | { type: 'metadata'; payload: FileMetadata }
  | { type: 'chunk'; payload: ArrayBuffer; index: number; totalChunks: number }
  | { type: 'end' };

export default function Receiver({ remotePeerId }: ReceiverProps) {
  const [fileInfo, setFileInfo] = useState<FileMetadata | null>(null);
  const [status, setStatus] = useState('Connecting to peer...');
  const [progress, setProgress] = useState(0);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [isReceiving, setIsReceiving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const peerRef = useRef<Peer | null>(null);
  const connRef = useRef<DataConnection | null>(null);
  const receivedChunksRef = useRef<ArrayBuffer[]>([]);
  const receivedSizeRef = useRef(0);
  const fileInfoRef = useRef<FileMetadata | null>(null);

  useEffect(() => {
    const initPeer = async () => {
      try {
        const { default: Peer } = await import('peerjs');
        const peer = new Peer({
          host: process.env.NEXT_PUBLIC_PEER_HOST || '0.peerjs.com',
          port: +(process.env.NEXT_PUBLIC_PEER_PORT || 443),
          path: process.env.NEXT_PUBLIC_PEER_PATH || '/',
          secure: process.env.NEXT_PUBLIC_PEER_SECURE === 'true',
          config: {
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:stun1.l.google.com:19302' },
              { urls: 'stun:stun.cloudflare.com:3478' },
              ...(process.env.NEXT_PUBLIC_STUN_URL
                ? [
                    {
                      urls: process.env.NEXT_PUBLIC_STUN_URL,
                      username: process.env.NEXT_PUBLIC_STUN_USERNAME,
                      credential: process.env.NEXT_PUBLIC_STUN_CREDENTIAL,
                    },
                  ]
                : []),
            ],
          },
        });
        peerRef.current = peer;

        const onOpen = () => {
          if (!peerRef.current) return;
          const conn = peerRef.current.connect(remotePeerId, {
            reliable: true,
          });
          connRef.current = conn;
          setupConnectionHandlers(conn);
        };

        const onError = (err: Error) => {
          setError(
            `Connection error: ${err.message}. Please check the link or ask the sender to generate a new one.`,
          );
          setStatus('Connection failed.');
          addToast({
            title: 'Connection Error',
            description: err.message,
            color: 'danger',
          });
        };

        const setupConnectionHandlers = (conn: DataConnection) => {
          conn.on('open', () => {
            setStatus('Connected! Waiting for file...');
          });
          conn.on('data', onData);
          conn.on('close', onClose);
          conn.on('error', onError);
        };

        const onData = (data: unknown) => {
          const peerData = data as PeerData;

          if (peerData.type === 'metadata') {
            const metadata = peerData.payload;
            fileInfoRef.current = metadata;
            setFileInfo(metadata);
            setIsReceiving(true);
            setStatus(`Receiving ${metadata.name}...`);

            // Reset for new file transfer
            receivedChunksRef.current = [];
            receivedSizeRef.current = 0;
            setDownloadUrl(null);
            setProgress(0);
            setError(null);
          } else if (peerData.type === 'chunk') {
            const chunk = peerData.payload;
            receivedChunksRef.current.push(chunk);
            receivedSizeRef.current += chunk.byteLength;

            if (fileInfoRef.current) {
              const currentProgress =
                (receivedSizeRef.current / fileInfoRef.current.size) * 100;
              setProgress(currentProgress);
            }
          } else if (peerData.type === 'end') {
            if (fileInfoRef.current) {
              const fileBlob = new Blob(receivedChunksRef.current, {
                type: fileInfoRef.current.type,
              });
              const url = URL.createObjectURL(fileBlob);
              setDownloadUrl(url);
              setStatus('File received! Click to download.');
              setIsReceiving(false);
              fileInfoRef.current = null; // Reset for next transfer
            }
          }
        };

        const onClose = () => {
          // Only show error if a file wasn't successfully received.
          if (!downloadUrl && !isReceiving) {
            setError('Connection closed by peer.');
            setStatus('Connection closed.');
          }
        };

        peer.on('open', onOpen);
        peer.on('error', onError);
      } catch (e) {
        console.error('Failed to initialize PeerJS', e);
        setError(
          'Could not initialize sharing service. Your browser might not be supported.',
        );
        setStatus('Initialization failed.');
      }
    };

    initPeer();

    return () => {
      connRef.current?.close();
      peerRef.current?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remotePeerId]);

  const renderContent = () => {
    if (error) {
      return (
        <div className="text-destructive flex flex-col items-center gap-4 text-center">
          <XCircle className="h-12 w-12" />
          <p className="font-semibold">Failed to Connect</p>
          <p className="text-sm">{error}</p>
        </div>
      );
    }

    if (!fileInfo) {
      return (
        <div className="text-muted-foreground flex flex-col items-center gap-4 text-center">
          <Loader2 className="h-12 w-12 animate-spin" />
          <p className="font-semibold">{status}</p>
        </div>
      );
    }

    if (downloadUrl) {
      return (
        <div className="flex flex-col items-center gap-4 text-center">
          <CheckCircle2 className="h-12 w-12 text-green-500" />
          <p className="font-semibold">Download Ready!</p>
          <a className="w-full" href={downloadUrl} download={fileInfo.name}>
            <Button className="w-full justify-start">
              <Download className="h-5 w-5 shrink-0" />
              <p className="truncate">Download {fileInfo.name}</p>
            </Button>
          </a>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <div className="bg-muted/50 flex items-center gap-4 rounded-lg border p-4">
          <FileIcon className="text-primary h-8 w-8" />
          <div className="flex flex-col">
            <p className="truncate font-semibold">{fileInfo.name}</p>
            <p className="text-muted-foreground text-sm">
              {formatBytes(fileInfo.size)}
            </p>
          </div>
        </div>
      </div>
    );
  };

  return (
    <Card className="w-full max-w-md shadow-lg">
      <CardHeader className="flex-col text-center">
        <div className="mb-2 flex items-center justify-center gap-2">
          <Share2 className="text-primary h-8 w-8" />
          <h4 className="font-headline text-3xl tracking-tight">PeerShare</h4>
        </div>
        <p className="text-center">{!isReceiving && status}</p>
      </CardHeader>
      <CardBody className="flex flex-col justify-center">
        {renderContent()}
      </CardBody>
      {(isReceiving || (progress > 0 && !downloadUrl)) && (
        <CardFooter className="flex flex-col gap-2">
          <div className="w-full text-center">
            <p className="animate-pulse text-sm">{status}</p>
          </div>
          <Progress value={progress} className="w-full" />
        </CardFooter>
      )}
    </Card>
  );
}
