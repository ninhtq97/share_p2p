'use client';

import React, { useEffect, useRef, useState } from 'react';

import { Button, addToast } from '@heroui/react';
import {
  Check,
  Copy,
  File as FileIcon,
  Loader2,
  UploadCloud,
} from 'lucide-react';
import type { DataConnection, Peer } from 'peerjs';

import { formatBytes } from '@/lib/utils';

const CHUNK_SIZE = 65536; // 64KB

export default function Sender() {
  const [peerId, setPeerId] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState('Select a file to begin sharing.');
  const [progress, setProgress] = useState(0);
  const [isCopied, setIsCopied] = useState(false);
  const [isSending, setIsSending] = useState(false);

  const peerRef = useRef<Peer | null>(null);
  const connRef = useRef<DataConnection | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<File | null>(null);

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

        peer.on('open', (id) => {
          setPeerId(id);
        });

        peer.on('connection', (conn) => {
          connRef.current = conn;
          setStatus('Peer connected. Ready to send file.');

          conn.on('open', () => {
            if (fileRef.current) {
              sendFile(fileRef.current, conn);
            }
          });

          conn.on('close', () => {
            setStatus('Peer disconnected. Share link again.');
            connRef.current = null;
          });
        });

        peer.on('error', (err) => {
          console.error('PeerJS error:', err);
          setStatus('An error occurred. Please refresh.');
          addToast({
            title: 'Connection Error',
            description: err.message,
            color: 'danger',
          });
        });
      } catch (error) {
        console.error('Failed to initialize PeerJS', error);
        setStatus('Could not initialize sharing service.');
      }
    };

    initPeer();

    return () => {
      connRef.current?.close();
      peerRef.current?.destroy();
    };
  }, []);

  const sendFile = (fileToSend: File, conn: DataConnection) => {
    if (!conn || !conn.open) {
      setStatus('Connection is not open. Cannot send file.');
      return;
    }

    setIsSending(true);
    setStatus('Sending file...');
    setProgress(0);

    conn.send({
      type: 'metadata',
      payload: {
        name: fileToSend.name,
        size: fileToSend.size,
        type: fileToSend.type,
      },
    });

    const fileReader = new FileReader();
    let offset = 0;

    fileReader.onload = (e) => {
      if (e.target?.result) {
        const chunk = e.target.result as ArrayBuffer;
        try {
          if (connRef.current?.open) {
            connRef.current.send({ type: 'chunk', payload: chunk });
            offset += chunk.byteLength;
            setProgress((offset / fileToSend.size) * 100);

            if (offset < fileToSend.size) {
              readSlice(offset);
            } else {
              setStatus('File sent successfully!');
              setIsSending(false);
              connRef.current.send({ type: 'end' });
            }
          }
        } catch (e) {
          console.error('Send error:', e);
          setStatus(
            'An error occurred during sending. Peer may have disconnected.',
          );
          setIsSending(false);
        }
      }
    };

    fileReader.onerror = (error) => {
      console.error('FileReader error:', error);
      setStatus('Error reading file.');
      setIsSending(false);
    };

    const readSlice = (o: number) => {
      const slice = fileToSend.slice(o, o + CHUNK_SIZE);
      fileReader.readAsArrayBuffer(slice);
    };

    readSlice(0);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      fileRef.current = selectedFile;
      setProgress(0);
      setIsSending(false);

      if (connRef.current && connRef.current.open) {
        sendFile(selectedFile, connRef.current);
      } else {
        setStatus('File selected. Share the link to start the transfer.');
      }
    }
  };

  const shareUrl = peerId ? `${window.location.origin}/receive/${peerId}` : '';

  const copyToClipboard = () => {
    if (!shareUrl) return;
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard
        .writeText(shareUrl)
        .then(() => {
          setIsCopied(true);
          addToast({
            title: 'Copied to clipboard!',
            description: 'You can now share the link with anyone.',
            color: 'success',
          });
          setTimeout(() => setIsCopied(false), 2000);
        })
        .catch(() => {
          fallbackCopyToClipboard(shareUrl, setIsCopied, addToast);
        });
    } else {
      fallbackCopyToClipboard(shareUrl, setIsCopied, addToast);
    }
  };

  const fallbackCopyToClipboard = (
    text: string,
    setIsCopied: React.Dispatch<React.SetStateAction<boolean>>,
    onToast: typeof addToast,
  ) => {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    try {
      const successful = document.execCommand('copy');
      if (successful) {
        setIsCopied(true);
        onToast({
          title: 'Đã sao chép vào clipboard!',
          description: 'Bạn có thể chia sẻ liên kết với bất kỳ ai.',
          color: 'success',
        });
        setTimeout(() => setIsCopied(false), 2000);
      } else {
        console.error('Sao chép thất bại với execCommand.');
        onToast({
          title: 'Sao chép thất bại!',
          description: 'Trình duyệt không hỗ trợ sao chép tự động.',
          color: 'danger',
        });
      }
    } catch (err) {
      console.error('Không thể thực thi lệnh sao chép:', err);
      onToast({
        title: 'Sao chép thất bại!',
        description: 'Có lỗi xảy ra trong quá trình sao chép.',
        color: 'danger',
      });
    } finally {
      document.body.removeChild(textArea);
    }
  };

  const handleReset = () => {
    setFile(null);
    fileRef.current = null;
    setProgress(0);
    setIsSending(false);
    setStatus('Select a file to begin sharing.');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const renderContent = () => {
    if (!file) {
      return (
        <div className="text-center">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            className="hidden"
          />
          <Button
            onPress={() => fileInputRef.current?.click()}
            size="lg"
            className="bg-card hover:bg-accent/10 h-32 w-full border-2 border-dashed"
          >
            <div className="text-muted-foreground flex flex-col items-center gap-2">
              <UploadCloud className="h-10 w-10" />
              <span className="font-semibold">Click to select a file</span>
            </div>
          </Button>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <div className="bg-muted/50 flex items-center gap-4 rounded-lg border p-4">
          <FileIcon className="text-primary h-8 w-8" />
          <div className="">
            <p className="truncate font-semibold">{file.name}</p>
            <p className="text-muted-foreground text-sm">
              {formatBytes(file.size)}
            </p>
          </div>
        </div>

        {!peerId ? (
          <div className="text-muted-foreground flex items-center justify-center gap-2 py-4">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>Initializing sharing session...</span>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-center text-sm font-medium">Share this link:</p>
            <div className="flex gap-2">
              <Button isDisabled>
                <p className="truncate">{shareUrl}</p>
              </Button>
              <Button onPress={copyToClipboard} isIconOnly>
                {isCopied ? (
                  <Check className="h-5 w-5 text-green-500" />
                ) : (
                  <Copy className="h-5 w-5" />
                )}
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  };
}
