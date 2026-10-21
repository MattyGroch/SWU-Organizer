import { Link, type ActiveOptions } from '@tanstack/react-router';
import { type ReactNode } from 'react';

import { useSharedCollection } from '~/data/shared';

import type { InventoryTarget } from './inventoryNavigate';

type LinkProps = {
  target: InventoryTarget;
  className?: string;
  'aria-current'?: 'page';
  activeOptions?: ActiveOptions;
  onClick?: () => void;
  children: ReactNode;
};

/** A `<Link>` to a place in whichever collection is on screen. */
export function InventoryLink({ target, children, ...rest }: LinkProps) {
  const token = useSharedCollection()?.token;
  if (token === undefined) {
    switch (target.place) {
      case 'set':
        return (
          <Link
            to="/inventory/$setKey/$view"
            params={{ setKey: target.setKey, view: target.view }}
            search={target.card === undefined ? {} : { card: target.card }}
            {...rest}
          >
            {children}
          </Link>
        );
      case 'bulk':
        return (
          <Link to="/inventory/bulk" {...rest}>
            {children}
          </Link>
        );
      case 'stats':
        return (
          <Link to="/inventory/stats" {...rest}>
            {children}
          </Link>
        );
      case 'home':
        return (
          <Link to="/inventory" {...rest}>
            {children}
          </Link>
        );
    }
  }
  switch (target.place) {
    case 'set':
      return (
        <Link
          to="/share/$token/$setKey/$view"
          params={{ token, setKey: target.setKey, view: target.view }}
          search={target.card === undefined ? {} : { card: target.card }}
          {...rest}
        >
          {children}
        </Link>
      );
    case 'bulk':
      return (
        <Link to="/share/$token/bulk" params={{ token }} {...rest}>
          {children}
        </Link>
      );
    case 'stats':
      return (
        <Link to="/share/$token/stats" params={{ token }} {...rest}>
          {children}
        </Link>
      );
    case 'home':
      return (
        <Link to="/share/$token" params={{ token }} {...rest}>
          {children}
        </Link>
      );
  }
}
