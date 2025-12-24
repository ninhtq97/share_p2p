'use client';

import Image from 'next/image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  Avatar,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  Divider,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalHeader,
  Progress,
  Table,
  TableBody,
  TableCell,
  TableColumn,
  TableHeader,
  TableRow,
  Tooltip,
  addToast,
} from '@heroui/react';
import {
  Check,
  Copy,
  Download,
  Eye,
  File as FileIcon,
  Link2 as LinkIcon,
  LogOut,
  Send,
  Share2,
  UploadCloud,
  Users,
} from 'lucide-react';
import type { DataConnection, Peer } from 'peerjs';
import QRCode from 'qrcode';

import { formatBytes } from '@/lib/utils';

const CHUNK_SIZE = 65536; // 64KB

type FileMetadata = {
  name: string;
  size: number;
  type: string;
  senderId: string;
  senderName: string;
  fileId: string;
};

type RoomUser = {
  peerId: string;
  name: string;
};

type PeerData =
  | { type: 'join'; payload: { name: string; peerId: string } }
  | { type: 'user-list'; payload: RoomUser[] }
  | { type: 'user-joined'; payload: RoomUser }
  | { type: 'user-left'; payload: { peerId: string } }
  | { type: 'metadata'; payload: FileMetadata }
  | {
      type: 'chunk';
      payload: ArrayBuffer;
      index: number;
      totalChunks: number;
      fileId: string;
    }
  | { type: 'end'; payload: { fileId: string } };

type ReceivedFile = {
  metadata: FileMetadata;
  progress: number;
  chunks: ArrayBuffer[];
  receivedSize: number;
  downloadUrl: string | null;
  completed: boolean;
  toastShown?: boolean;
  timestamp: number;
  completedAt?: number;
};

type SentFile = {
  metadata: FileMetadata;
  downloadUrl: string;
  timestamp: number;
  blob?: Blob;
  progress?: number;
  completed?: boolean;
};

type RoomProps = {
  roomId: string;
};

export default function Room({ roomId }: RoomProps) {
  const [myPeerId, setMyPeerId] = useState<string | null>(null);
  const [myName, setMyName] = useState('');
  const [isJoined, setIsJoined] = useState(false);
  const [users, setUsers] = useState<RoomUser[]>([]);
  const [status, setStatus] = useState('Initializing...');
  const [isSending, setIsSending] = useState(false);
  const [receivedFiles, setReceivedFiles] = useState<Map<string, ReceivedFile>>(
    new Map(),
  );
  const [sentFiles, setSentFiles] = useState<SentFile[]>([]);
  const [isCopied, setIsCopied] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [qrError, setQrError] = useState('');
  const [isQrLoading, setIsQrLoading] = useState(false);

  const peerRef = useRef<Peer | null>(null);
  const connectionsRef = useRef<Map<string, DataConnection>>(new Map());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const usersRef = useRef<RoomUser[]>([]);
  const myNameRef = useRef('');
  const myPeerIdRef = useRef<string | null>(null);
  const connectToPeerRef = useRef<(peerId: string) => void>(() => {});

  const broadcastToOthers = useCallback(
    (data: PeerData, excludePeerId?: string) => {
      connectionsRef.current.forEach((conn, peerId) => {
        if (peerId !== excludePeerId && conn.open) {
          try {
            conn.send(data);
          } catch (error) {
            console.error('Failed to send to peer:', error);
          }
        }
      });
    },
    [],
  );

  const handleData = useCallback((data: PeerData) => {
    if (data.type === 'join') {
      const newUser = data.payload;
      setUsers((prev) => {
        if (!prev.find((u) => u.peerId === newUser.peerId)) {
          const updated = [...prev, newUser];
          usersRef.current = updated;
          return updated;
        }
        return prev;
      });
    } else if (data.type === 'user-list') {
      const userList = data.payload.filter(
        (u) => u.peerId !== myPeerIdRef.current,
      );
      // Merge with existing users to avoid losing peers
      setUsers((prev) => {
        const merged = new Map<string, RoomUser>();
        // Keep existing users
        prev.forEach((u) => merged.set(u.peerId, u));
        // Add/update new users from list
        userList.forEach((u) => merged.set(u.peerId, u));
        const updated = Array.from(merged.values());
        usersRef.current = updated;
        return updated;
      });
    } else if (data.type === 'user-joined') {
      const newUser = data.payload;
      setUsers((prev) => {
        if (!prev.find((u) => u.peerId === newUser.peerId)) {
          const updated = [...prev, newUser];
          usersRef.current = updated;
          return updated;
        }
        return prev;
      });

      // Connect to the new user if not already connected
      if (
        !connectionsRef.current.has(newUser.peerId) &&
        newUser.peerId !== myPeerIdRef.current
      ) {
        connectToPeerRef.current(newUser.peerId);
      }
    } else if (data.type === 'user-left') {
      const peerId = data.payload.peerId;
      setUsers((prev) => {
        const updated = prev.filter((u) => u.peerId !== peerId);
        usersRef.current = updated;
        return updated;
      });

      // Close connection to the peer that left to ensure cleanup
      const conn = connectionsRef.current.get(peerId);
      if (conn) {
        conn.close();
        connectionsRef.current.delete(peerId);
      }
    } else if (data.type === 'metadata') {
      const metadata = data.payload;
      setReceivedFiles((prev) => {
        const newMap = new Map(prev);
        const existing = newMap.get(metadata.fileId);
        // Ignore duplicate sends if already completed
        if (existing?.completed) return prev;
        if (!existing) {
          newMap.set(metadata.fileId, {
            metadata,
            progress: 0,
            chunks: [],
            receivedSize: 0,
            downloadUrl: null,
            completed: false,
            timestamp: Date.now(),
          });
        }
        return newMap;
      });
    } else if (data.type === 'chunk') {
      const payload = data.payload as ArrayBuffer | Uint8Array;
      let chunk: ArrayBuffer;
      if (payload instanceof ArrayBuffer) {
        chunk = payload;
      } else {
        chunk = payload.slice(0).buffer as ArrayBuffer;
      }
      const fileId = data.fileId;
      setReceivedFiles((prev) => {
        const newMap = new Map(prev);
        const file = prev.get(fileId);

        if (file && !file.completed) {
          const updatedFile = {
            ...file,
            chunks: [...file.chunks, chunk],
            receivedSize: file.receivedSize + chunk.byteLength,
            progress:
              ((file.receivedSize + chunk.byteLength) / file.metadata.size) *
              100,
          };
          newMap.set(fileId, updatedFile);
        } else {
          return prev;
        }
        return newMap;
      });
    } else if (data.type === 'end') {
      const fileId = data.payload.fileId;
      setReceivedFiles((prev) => {
        const newMap = new Map(prev);
        const file = prev.get(fileId);

        if (file && !file.completed) {
          const fileBlob = new Blob(file.chunks, {
            type: file.metadata.type,
          });
          const url = URL.createObjectURL(fileBlob);
          newMap.set(fileId, {
            ...file,
            downloadUrl: url,
            completed: true,
            progress: 100,
            completedAt: Date.now(),
          });
        } else {
          return prev;
        }
        return newMap;
      });
    }
  }, []);

  const setupConnectionHandlers = useCallback(
    (conn: DataConnection) => {
      const remotePeerId = conn.peer;

      conn.on('open', () => {
        connectionsRef.current.set(remotePeerId, conn);

        // When connection opens, send current user list to ensure sync
        if (myPeerIdRef.current && myNameRef.current) {
          const currentUsers = [
            { peerId: myPeerIdRef.current, name: myNameRef.current },
            ...usersRef.current.filter((u) => u.peerId !== remotePeerId),
          ];
          conn.send({ type: 'user-list', payload: currentUsers });
        }
      });

      conn.on('data', (data: unknown) => {
        handleData(data as PeerData);
      });

      conn.on('close', () => {
        connectionsRef.current.delete(remotePeerId);
        setUsers((prev) => {
          const updated = prev.filter((u) => u.peerId !== remotePeerId);
          usersRef.current = updated;
          return updated;
        });

        // Notify other peers that this user left
        broadcastToOthers({
          type: 'user-left',
          payload: { peerId: remotePeerId },
        });
      });

      conn.on('error', (err) => {
        console.error('Connection error with', remotePeerId, ':', err);
        connectionsRef.current.delete(remotePeerId);
        setUsers((prev) => {
          const updated = prev.filter((u) => u.peerId !== remotePeerId);
          usersRef.current = updated;
          return updated;
        });

        // Notify other peers that this user left
        broadcastToOthers({
          type: 'user-left',
          payload: { peerId: remotePeerId },
        });
      });
    },
    [broadcastToOthers, handleData],
  );

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
          setMyPeerId(id);
          myPeerIdRef.current = id;
          setStatus('Ready to join room');
        });

        peer.on('connection', (conn) => {
          setupConnectionHandlers(conn);
        });

        peer.on('disconnected', () => {
          setStatus('Disconnected. Attempting to reconnect...');
          peer.reconnect();
        });

        peer.on('error', (err) => {
          console.error('PeerJS error:', err);
          if (err.type === 'network') {
            console.log('Đang thử kết nối lại với server...');
            setTimeout(() => {
              if (!peer.destroyed) peer.reconnect();
            }, 3000);
          } else {
            setStatus('Connection error occurred');
            addToast({
              title: 'Connection Error',
              description: err.message,
              color: 'danger',
            });
          }
        });
      } catch (error) {
        console.error('Failed to initialize PeerJS', error);
        setStatus('Failed to initialize');
      }
    };

    initPeer();

    return () => {
      peerRef.current?.destroy();
    };
  }, [setupConnectionHandlers]);

  // Cleanup and notify others when leaving room
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (isJoined && myPeerIdRef.current) {
        // Notify peers via P2P
        broadcastToOthers({
          type: 'user-left',
          payload: { peerId: myPeerIdRef.current },
        });

        // Remove from server registry
        fetch(`/api/rooms/${roomId}/peers`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ peerId: myPeerIdRef.current }),
          keepalive: true,
        }).catch(() => {});
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [broadcastToOthers, isJoined, roomId]);

  // Handle tab visibility: reconnect if peer lost connection while in background
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) return; // Tab is hidden, do nothing

      // Tab is now visible - check if peer connection is still healthy
      if (peerRef.current && !peerRef.current.destroyed) {
        if (peerRef.current.disconnected) {
          console.log(
            'Tab became visible, peer was disconnected. Reconnecting...',
          );
          peerRef.current.reconnect();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const joinRoom = async () => {
    if (!myName.trim()) {
      addToast({
        title: 'Name Required',
        description: 'Please enter your name',
        color: 'warning',
      });
      return;
    }

    if (!myPeerId) {
      addToast({
        title: 'Not Ready',
        description: 'Please wait for initialization',
        color: 'warning',
      });
      return;
    }

    myNameRef.current = myName;
    setStatus('Joining room...');

    try {
      await fetch(`/api/rooms/${roomId}/peers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peerId: myPeerId, name: myName }),
      });

      const response = await fetch(`/api/rooms/${roomId}/peers`);
      if (!response.ok) {
        throw new Error('Failed to fetch peers');
      }

      const data = (await response.json()) as { peers: RoomUser[] };
      const otherPeers = data.peers.filter((peer) => peer.peerId !== myPeerId);

      setUsers(otherPeers);
      usersRef.current = otherPeers;

      otherPeers.forEach((peer) => {
        if (!connectionsRef.current.has(peer.peerId)) {
          connectToPeer(peer.peerId);
        }
      });

      setIsJoined(true);
      setStatus('Joined room');
    } catch (error) {
      console.error('Failed to join room:', error);
      setIsJoined(false);
      setStatus('Failed to join room');
      addToast({
        title: 'Join Failed',
        description: 'Could not join room. Please try again.',
        color: 'danger',
      });
    }
  };

  const connectToPeer = useCallback(
    (targetPeerId: string) => {
      if (!peerRef.current || !myPeerId || !myName) return;

      if (connectionsRef.current.has(targetPeerId)) return;

      try {
        const conn = peerRef.current.connect(targetPeerId, {
          reliable: true,
          serialization: 'binary',
        });

        setupConnectionHandlers(conn);

        // Set a timeout for connection attempts
        const connectionTimeout = setTimeout(() => {
          if (!conn.open) {
            console.warn(`Connection timeout for peer ${targetPeerId}`);
            conn.close();
            connectionsRef.current.delete(targetPeerId);
          }
        }, 10000); // 10 second timeout

        conn.on('open', () => {
          clearTimeout(connectionTimeout);
          conn.send({
            type: 'join',
            payload: { name: myName, peerId: myPeerId },
          });
        });

        conn.on('error', (err) => {
          clearTimeout(connectionTimeout);
          console.error('Failed to connect to peer:', targetPeerId, err);
          connectionsRef.current.delete(targetPeerId);
        });
      } catch (error) {
        console.error('Failed to initiate connection to peer:', error);
      }
    },
    [myName, myPeerId, setupConnectionHandlers],
  );

  // Update the ref so handleData can use it without circular dependency
  useEffect(() => {
    connectToPeerRef.current = connectToPeer;
  }, [connectToPeer]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (files.length > 0) {
      setSelectedFiles(files);
    }
  };

  const sendSingleFile = (
    file: File,
    isResend = false,
    existingFileId?: string,
  ) => {
    if (!myPeerId || !myName) return;

    if (connectionsRef.current.size === 0) {
      addToast({
        title: 'No Recipients',
        description: 'No other users in the room',
        color: 'warning',
      });
      return;
    }

    setIsSending(true);

    const fileId = existingFileId || `${myPeerId}_${Date.now()}_${file.name}`;
    const metadata: FileMetadata = {
      name: file.name,
      size: file.size,
      type: file.type,
      senderId: myPeerId,
      senderName: myName,
      fileId,
    };

    // Add to sent files immediately with progress 0 (only if not a resend)
    if (!isResend) {
      const fileBlob = new Blob([file], { type: file.type });
      setSentFiles((prev) => [
        {
          metadata,
          downloadUrl: '',
          timestamp: Date.now(),
          blob: fileBlob,
          progress: 0,
          completed: false,
        },
        ...prev,
      ]);
    }

    broadcastToOthers({ type: 'metadata', payload: metadata });

    const fileReader = new FileReader();
    let offset = 0;

    fileReader.onload = (e) => {
      if (e.target?.result) {
        const chunk = e.target.result as ArrayBuffer;
        broadcastToOthers({
          type: 'chunk',
          payload: chunk,
          index: 0,
          totalChunks: 0,
          fileId,
        });

        offset += chunk.byteLength;
        const progress = (offset / file.size) * 100;

        // Update progress of the sent file in history
        if (!isResend) {
          setSentFiles((prev) =>
            prev.map((f) =>
              f.metadata.fileId === fileId ? { ...f, progress } : f,
            ),
          );
        }

        if (offset < file.size) {
          readSlice(offset);
        } else {
          broadcastToOthers({ type: 'end', payload: { fileId } });
          setIsSending(false);

          // Mark as completed and set download URL
          if (!isResend) {
            const fileBlob = new Blob([file], { type: file.type });
            const downloadUrl = URL.createObjectURL(fileBlob);
            setSentFiles((prev) =>
              prev.map((f) =>
                f.metadata.fileId === fileId
                  ? {
                      ...f,
                      downloadUrl,
                      progress: 100,
                      completed: true,
                    }
                  : f,
              ),
            );
          }

          addToast({
            title: isResend ? 'File Resent' : 'File Sent',
            description: `${file.name} sent to ${connectionsRef.current.size} user(s)`,
            color: 'success',
          });
        }
      }
    };

    fileReader.onerror = () => {
      setIsSending(false);
      addToast({
        title: 'Error',
        description: 'Failed to read file',
        color: 'danger',
      });
    };

    const readSlice = (o: number) => {
      const slice = file.slice(o, o + CHUNK_SIZE);
      fileReader.readAsArrayBuffer(slice);
    };

    readSlice(0);
  };

  const sendFileToAll = () => {
    if (selectedFiles.length === 0 || !myPeerId || !myName) return;

    if (connectionsRef.current.size === 0) {
      addToast({
        title: 'No Recipients',
        description: 'No other users in the room',
        color: 'warning',
      });
      return;
    }

    selectedFiles.forEach((file) => sendSingleFile(file));
    setSelectedFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const roomUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/room/${roomId}`
      : '';

  const copyRoomLink = () => {
    if (!roomUrl) {
      addToast({
        title: 'Unavailable',
        description: 'Room link is not ready yet',
        color: 'warning',
      });
      return;
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard
        .writeText(roomUrl)
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
          fallbackCopyToClipboard(roomUrl, setIsCopied, addToast);
        });
    } else {
      fallbackCopyToClipboard(roomUrl, setIsCopied, addToast);
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
          title: 'Copied!',
          description: 'You can now share the link with anyone.',
          color: 'success',
        });
        setTimeout(() => setIsCopied(false), 2000);
      } else {
        console.error('Copy failed with execCommand.');
        onToast({
          title: 'Copy Failed!',
          description: 'Your browser does not support automatic copying.',
          color: 'danger',
        });
      }
    } catch (err) {
      console.error('Failed to execute copy command:', err);
      onToast({
        title: 'Copy Failed!',
        description: 'An error occurred during copying.',
        color: 'danger',
      });
    } finally {
      document.body.removeChild(textArea);
    }
  };

  const openShareModal = async () => {
    if (!roomUrl) return;
    setIsShareOpen(true);
    setQrError('');
    setIsQrLoading(true);
    try {
      const dataUrl = await QRCode.toDataURL(roomUrl, {
        width: 260,
        margin: 1,
      });
      setQrDataUrl(dataUrl);
    } catch (error) {
      console.error('Failed to generate QR code', error);
      setQrError(
        'Failed to generate QR code, please use the Copy Link button.',
      );
    } finally {
      setIsQrLoading(false);
    }
  };

  const historyItems = useMemo(() => {
    const receivedList = Array.from(receivedFiles.entries()).map(
      ([key, file]) => ({
        id: `recv-${key}`,
        direction: 'received' as const,
        name: file.metadata.name,
        size: file.metadata.size,
        peerName: file.metadata.senderName,
        downloadUrl: file.downloadUrl,
        progress: file.progress,
        completed: file.completed,
        timestamp: file.completedAt ?? file.timestamp,
        file,
      }),
    );

    const sentList = sentFiles.map((file, index) => ({
      id: `sent-${file.metadata.fileId || file.metadata.name}-${index}`,
      direction: 'sent' as const,
      name: file.metadata.name,
      size: file.metadata.size,
      peerName: 'Everyone',
      downloadUrl: file.downloadUrl,
      progress: file.progress ?? 100,
      completed: file.completed ?? true,
      timestamp: file.timestamp,
      file,
    }));

    return [...sentList, ...receivedList].sort(
      (a, b) => b.timestamp - a.timestamp,
    );
  }, [receivedFiles, sentFiles]);

  const handleLeaveRoom = async () => {
    if (myPeerIdRef.current) {
      try {
        // Notify peers via P2P
        broadcastToOthers({
          type: 'user-left',
          payload: { peerId: myPeerIdRef.current },
        });

        // Remove from server registry
        await fetch(`/api/rooms/${roomId}/peers`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ peerId: myPeerIdRef.current }),
        });

        // Close all connections
        connectionsRef.current.forEach((conn) => conn.close());
        connectionsRef.current.clear();

        // Reset state
        setIsJoined(false);
        setUsers([]);
        setSelectedFiles([]);
        setReceivedFiles(new Map());
        setSentFiles([]);
        setStatus('Left room');

        addToast({
          title: 'Left Room',
          description: 'You have left the room',
          color: 'warning',
        });
      } catch (error) {
        console.error('Failed to leave room:', error);
        addToast({
          title: 'Error',
          description: 'Failed to leave room',
          color: 'danger',
        });
      }
    }
  };

  if (!isJoined) {
    return (
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader className="flex-col gap-3 pb-6">
          <div className="flex items-center justify-center gap-3">
            <div className="from-primary-400 to-primary-600 bg--to-br flex h-14 w-14 items-center justify-center rounded-full shadow-lg">
              <Users className="text-primary h-10 w-10" />
            </div>
            <h4 className="font-headline text-3xl font-bold tracking-tight">
              Join Room
            </h4>
          </div>
          <Chip color="primary" variant="flat" size="md" radius="full">
            Room: {roomId}
          </Chip>
        </CardHeader>
        <Divider />
        <CardBody className="gap-6 py-6">
          <Input
            label="Your Name"
            value={myName}
            onChange={(e) => setMyName(e.target.value)}
            placeholder="Enter your name"
            size="lg"
            radius="lg"
            onKeyDown={(e) => e.key === 'Enter' && joinRoom()}
          />
          <Button
            onPress={joinRoom}
            color="primary"
            size="lg"
            radius="lg"
            className="w-full font-semibold shadow-lg"
            isDisabled={
              !myName.trim() || !myPeerId || status === 'Initializing...'
            }
            isLoading={status === 'Joining room...'}
          >
            Join Room
          </Button>
          {status && status !== 'Joining room...' && (
            <Chip
              variant="flat"
              color={status.includes('Failed') ? 'danger' : 'default'}
              size="sm"
              className="mx-auto"
            >
              {status}
            </Chip>
          )}
        </CardBody>
      </Card>
    );
  }

  const shareDescription = `Share link or scan the QR code to join room ${roomId}`;

  return (
    <>
      <Card className="@container w-full max-w-3xl shadow-xl">
        <CardHeader className="flex-col gap-3 pb-4">
          <div className="flex w-full items-center gap-2 @max-sm:flex-col @sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="from-primary-400 to-primary-600 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-linear-to-br shadow-md">
                <Share2 className="h-6 w-6 text-white" />
              </div>
              <div className="overflow-hidden">
                <h4 className="line-clamp-1 text-2xl font-bold tracking-tight">
                  Room {roomId}
                </h4>
                <p className="text-default-500 line-clamp-1 w-full text-sm">
                  Share files with everyone in this room
                </p>
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <Tooltip
                content="Copy room link to invite others"
                placement="bottom"
              >
                <Button
                  size="sm"
                  color="primary"
                  variant="flat"
                  radius="lg"
                  onPress={openShareModal}
                  startContent={<Copy className="h-4 w-4 shrink-0" />}
                >
                  Share
                </Button>
              </Tooltip>
              <Tooltip content="Leave room" placement="bottom">
                <Button
                  size="sm"
                  color="danger"
                  variant="flat"
                  radius="lg"
                  onPress={handleLeaveRoom}
                  startContent={<LogOut className="h-4 w-4 shrink-0" />}
                >
                  Leave
                </Button>
              </Tooltip>
            </div>
          </div>
        </CardHeader>
        <Divider />
        <CardBody className="gap-6">
          {/* Users Section */}
          <div className="bg-default-50 border-default-100 rounded-xl border p-5">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="from-primary-100 to-primary-200 flex h-8 w-8 items-center justify-center rounded-lg bg-linear-to-br">
                  <Users className="text-primary h-5 w-5" />
                </div>
                <h5 className="text-lg font-semibold">Participants</h5>
              </div>
              <Chip color="primary" size="sm" variant="flat" radius="full">
                {users.length + 1} online
              </Chip>
            </div>
            <div className="flex flex-wrap gap-4">
              <Tooltip content="You (Host)" placement="bottom">
                <div className="flex flex-col items-center gap-1.5 transition-transform hover:scale-105">
                  <Badge
                    content="You"
                    color="primary"
                    placement="bottom-right"
                    size="sm"
                  >
                    <Avatar
                      name={myName}
                      className="h-12 w-12"
                      color="primary"
                      isBordered
                    />
                  </Badge>
                  <span className="text-default-700 text-xs font-medium">
                    {myName}
                  </span>
                </div>
              </Tooltip>
              {users.map((user) => (
                <Tooltip
                  key={user.peerId}
                  content={user.name}
                  placement="bottom"
                >
                  <div className="flex flex-col items-center gap-1.5 transition-transform hover:scale-105">
                    <Avatar
                      name={user.name}
                      className="h-12 w-12"
                      color="secondary"
                      isBordered
                    />
                    <span className="text-default-600 text-xs">
                      {user.name}
                    </span>
                  </div>
                </Tooltip>
              ))}
            </div>
          </div>

          {/* Send File Section */}
          <div>
            <div className="mb-4 flex items-center gap-2">
              <div className="from-primary-100 to-primary-200 flex h-8 w-8 items-center justify-center rounded-lg bg-linear-to-br">
                <UploadCloud className="text-primary h-5 w-5" />
              </div>
              <h5 className="text-lg font-semibold">Send File</h5>
            </div>
            <div className="space-y-3">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={handleFileChange}
                className="hidden"
              />
              <Button
                onPress={() => fileInputRef.current?.click()}
                variant="bordered"
                size="lg"
                radius="lg"
                className="hover:border-primary w-full transition-colors"
                startContent={<UploadCloud className="h-5 w-5" />}
              >
                {selectedFiles.length > 0
                  ? `${selectedFiles.length} file(s) selected`
                  : 'Choose Files'}
              </Button>
              {selectedFiles.length > 0 && (
                <div className="space-y-3">
                  <div className="bg-primary-50 border-primary-200 rounded-lg border p-3">
                    <p className="text-primary-700 mb-2 text-xs font-semibold tracking-wide uppercase">
                      Selected Files ({selectedFiles.length})
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {selectedFiles.map((file, index) => (
                        <Chip
                          key={index}
                          variant="flat"
                          color="primary"
                          size="sm"
                          radius="md"
                          startContent={
                            <FileIcon className="h-3.5 w-3.5 shrink-0" />
                          }
                          onClose={() =>
                            setSelectedFiles((prev) =>
                              prev.filter((_, i) => i !== index),
                            )
                          }
                          className="text-xs"
                        >
                          <span className="line-clamp-1">
                            {file.name}
                            <span className="text-primary-600 ml-1 opacity-70">
                              ({formatBytes(file.size)})
                            </span>
                          </span>
                        </Chip>
                      ))}
                    </div>
                  </div>

                  <Button
                    onPress={sendFileToAll}
                    color="primary"
                    size="lg"
                    radius="lg"
                    className="w-full font-semibold shadow-lg"
                    isDisabled={connectionsRef.current.size === 0}
                    startContent={<Send className="h-5 w-5" />}
                  >
                    {connectionsRef.current.size === 0
                      ? 'No users to send to'
                      : `Send to ${connectionsRef.current.size} user${connectionsRef.current.size !== 1 ? 's' : ''}`}
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* File History (virtualized table, merged sent/received) */}
          {historyItems.length > 0 && (
            <div className="space-y-3">
              <div className="mb-2 flex items-center gap-2">
                <div className="from-success-100 to-success-200 flex h-8 w-8 items-center justify-center rounded-lg bg-linear-to-br">
                  <Download className="text-success h-5 w-5" />
                </div>
                <h5 className="text-lg font-semibold">File History</h5>
              </div>
              <Table
                isHeaderSticky
                isStriped
                isVirtualized
                aria-label="File history"
                maxTableHeight={500}
                rowHeight={40}
              >
                <TableHeader>
                  <TableColumn key="type">Type</TableColumn>
                  <TableColumn key="name">Name</TableColumn>
                  <TableColumn key="size">Size</TableColumn>
                  <TableColumn key="peer">From</TableColumn>
                  <TableColumn key="status">Status</TableColumn>
                  <TableColumn key="actions">Actions</TableColumn>
                </TableHeader>
                <TableBody items={historyItems} emptyContent="No files yet">
                  {(item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <Chip
                          size="sm"
                          color={
                            item.direction === 'sent' ? 'primary' : 'success'
                          }
                          variant="flat"
                        >
                          {item.direction === 'sent' ? 'Sent' : 'Received'}
                        </Chip>
                      </TableCell>
                      <TableCell>
                        <Tooltip content={item.name} placement="top">
                          <div className="max-w-[220px] overflow-hidden text-ellipsis whitespace-nowrap">
                            {item.name}
                          </div>
                        </Tooltip>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {formatBytes(item.size)}
                      </TableCell>
                      <TableCell>
                        {item.direction === 'sent' ? 'You' : `${item.peerName}`}
                      </TableCell>
                      <TableCell>
                        {item.completed ? (
                          <Chip size="sm" color="success" variant="flat">
                            Completed
                          </Chip>
                        ) : (
                          <Progress
                            isStriped
                            showValueLabel
                            className="min-w-[140px]"
                            value={item.progress}
                            color="success"
                            size="sm"
                          />
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          {item.direction === 'sent' ? (
                            <Tooltip
                              content="Resend file to others"
                              placement="top"
                            >
                              <Button
                                isIconOnly
                                size="sm"
                                color="warning"
                                variant="flat"
                                radius="lg"
                                startContent={<Send className="h-4 w-4" />}
                                onPress={() => {
                                  if (item.file.blob) {
                                    const resendFile = new File(
                                      [item.file.blob],
                                      item.file.metadata.name,
                                      { type: item.file.metadata.type },
                                    );
                                    sendSingleFile(
                                      resendFile,
                                      true,
                                      item.file.metadata.fileId,
                                    );
                                  }
                                }}
                                isDisabled={
                                  connectionsRef.current.size === 0 || isSending
                                }
                              />
                            </Tooltip>
                          ) : item.completed && item.downloadUrl ? (
                            <>
                              <Tooltip content="Preview file" placement="top">
                                <Button
                                  as="a"
                                  href={item.downloadUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  isIconOnly
                                  size="sm"
                                  color="primary"
                                  variant="flat"
                                  radius="lg"
                                  startContent={<Eye className="h-4 w-4" />}
                                />
                              </Tooltip>
                              <Tooltip content="Download file" placement="top">
                                <Button
                                  as="a"
                                  href={item.downloadUrl}
                                  download={item.name}
                                  isIconOnly
                                  size="sm"
                                  color="success"
                                  variant="flat"
                                  radius="lg"
                                  startContent={
                                    <Download className="h-4 w-4" />
                                  }
                                />
                              </Tooltip>
                            </>
                          ) : (
                            <Chip size="sm" variant="flat" color="default">
                              Pending
                            </Chip>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardBody>
      </Card>
      <Modal
        isOpen={isShareOpen}
        onOpenChange={setIsShareOpen}
        placement="center"
        size="lg"
        className="backdrop-blur"
      >
        <ModalContent>
          {() => (
            <>
              <ModalHeader className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <div className="from-primary-100 to-primary-200 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-linear-to-br">
                    <Share2 className="text-primary h-5 w-5" />
                  </div>
                  <div className="flex flex-col">
                    <p className="text-default-900 text-sm font-semibold">
                      Share room
                    </p>
                    <span className="text-default-500 line-clamp-1 text-sm">
                      {shareDescription}
                    </span>
                  </div>
                </div>
              </ModalHeader>
              <ModalBody>
                <div className="flex flex-col gap-4">
                  <div className="bg-default-50 border-default-200 rounded-lg border p-4 shadow-sm">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-default-700 text-sm font-semibold">
                        Room link
                      </p>
                    </div>
                    <div className="border-default-200 mt-2 flex items-center gap-2 rounded-lg border px-3 py-2">
                      <div className="from-primary-100 to-primary-200 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-linear-to-br">
                        <LinkIcon className="text-primary h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-default-800 line-clamp-2 text-sm break-all">
                          {roomUrl}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 flex gap-2">
                      <Button
                        size="sm"
                        color="primary"
                        radius="md"
                        className="flex-1"
                        onPress={copyRoomLink}
                        startContent={
                          isCopied ? (
                            <Check className="h-4 w-4" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )
                        }
                      >
                        Copy link
                      </Button>
                      <Button
                        size="sm"
                        variant="flat"
                        radius="md"
                        className="flex-1"
                        onPress={() => window?.open(roomUrl, '_blank')}
                      >
                        Open
                      </Button>
                    </div>
                  </div>

                  <div className="bg-default-50 border-default-200 flex flex-col items-center justify-center gap-3 rounded-lg border p-4 shadow-sm">
                    <div className="from-secondary-100 to-secondary-200 text-secondary-700 flex h-9 items-center gap-2 self-start rounded-full bg-linear-to-r px-3 text-xs font-semibold">
                      QR code
                    </div>
                    {isQrLoading ? (
                      <div className="text-default-500 text-sm">
                        Generating QR...
                      </div>
                    ) : qrError ? (
                      <div className="text-danger text-sm">{qrError}</div>
                    ) : qrDataUrl ? (
                      <div className="border-default-200 flex justify-center rounded-xl border bg-white p-3 shadow-sm">
                        <Image
                          width={192}
                          height={192}
                          src={qrDataUrl}
                          alt="Room QR"
                        />
                      </div>
                    ) : (
                      <div className="text-default-500 text-sm">
                        No QR data available.
                      </div>
                    )}
                    <p className="text-default-500 text-xs">
                      Scan QR code to open the room link directly
                    </p>
                  </div>
                </div>
              </ModalBody>
            </>
          )}
        </ModalContent>
      </Modal>
    </>
  );
}
