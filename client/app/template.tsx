'use client';

import { useRouter } from 'next/navigation';
import { FC } from 'react';

import { HeroUIProvider, ToastProvider } from '@heroui/react';
import { I18nProvider } from '@react-aria/i18n';
import {
  ThemeProvider as NextThemesProvider,
  type ThemeProviderProps,
} from 'next-themes';

import { cn } from '@/lib/utils';

const Template: FC<
  Partial<Pick<HTMLElement, 'className'> & ThemeProviderProps>
> = ({ children, className, ...props }) => {
  const router = useRouter();

  return (
    <HeroUIProvider
      locale="es-ES"
      navigate={router.push}
      className={cn('flex h-screen w-full flex-col', className)}
    >
      <ToastProvider />
      <NextThemesProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        {...props}
      >
        <I18nProvider locale="vi">
          <main
            className={cn(
              'relative flex flex-col gap-3 bg-white p-3 dark:bg-neutral-800',
            )}
          >
            {children}
          </main>
        </I18nProvider>
      </NextThemesProvider>
    </HeroUIProvider>
  );
};

export default Template;
