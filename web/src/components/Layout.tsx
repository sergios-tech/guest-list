import { Fragment, ReactNode, useMemo, useState } from 'react';
import {
  AppBar, Toolbar, IconButton, Typography, Box, Drawer, List,
  ListItemButton, ListItemIcon, ListItemText, useMediaQuery,
  Select, MenuItem, Button, Tooltip,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import DashboardIcon from '@mui/icons-material/Dashboard';
import PeopleIcon from '@mui/icons-material/People';
import TableRestaurantIcon from '@mui/icons-material/TableRestaurant';
import PrintIcon from '@mui/icons-material/Print';
import LogoutIcon from '@mui/icons-material/Logout';
import BusinessIcon from '@mui/icons-material/Business';
import { useTheme } from '@mui/material/styles';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../lib/auth';
import logoUrl from '../assets/Sergio_s_Tech_Logo_Official_Vector.svg';

const DRAWER_WIDTH = 240;
const DRAWER_WIDTH_COLLAPSED = 64;
const NAV_COLLAPSED_KEY = 'nav.collapsed';

export default function Layout({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [mobileOpen, setMobileOpen] = useState(false);
  // Desktop-only collapse state, persisted across reloads. Default expanded
  // (absent key → not 'true' → false).
  const [collapsed, setCollapsed] = useState<boolean>(
    () => localStorage.getItem(NAV_COLLAPSED_KEY) === 'true',
  );
  const { t, i18n } = useTranslation();
  const { logout, clients, currentClientId, switchClient, user } = useAuth();
  const loc = useLocation();

  // The mobile overlay always shows full labels; only the permanent desktop
  // drawer collapses to icons-only.
  const showLabels = isMobile || !collapsed;
  const drawerWidth = showLabels ? DRAWER_WIDTH : DRAWER_WIDTH_COLLAPSED;

  // One control drives both modes: on mobile it opens the temporary overlay,
  // on desktop it collapses/expands the permanent drawer. The collapse choice
  // is persisted here (only on a real toggle) rather than in an effect that
  // would redundantly re-write the same value on every mount.
  const handleNavToggle = () => {
    if (isMobile) {
      setMobileOpen((v) => !v);
      return;
    }
    setCollapsed((v) => {
      const next = !v;
      localStorage.setItem(NAV_COLLAPSED_KEY, String(next));
      return next;
    });
  };

  // Recomputed only when the route, language, or admin status actually changes
  // — not on every collapse/overlay toggle.
  const navItems = useMemo(
    () => [
      { to: '/', icon: <DashboardIcon />, label: t('nav.dashboard'), selected: loc.pathname === '/' },
      {
        to: '/invitations', icon: <PeopleIcon />, label: t('nav.invitations'),
        selected: loc.pathname.startsWith('/invitations'),
      },
      {
        to: '/seating', icon: <TableRestaurantIcon />, label: t('nav.seating'),
        selected: loc.pathname.startsWith('/seating'),
      },
      {
        to: '/print', icon: <PrintIcon />, label: t('nav.print'),
        selected: loc.pathname.startsWith('/print'),
      },
      ...(user?.isSuperAdmin
        ? [{
            to: '/admin/clients', icon: <BusinessIcon />, label: t('nav.admin'),
            selected: loc.pathname.startsWith('/admin'),
          }]
        : []),
    ],
    [t, loc.pathname, user?.isSuperAdmin],
  );

  const year = new Date().getFullYear();
  const drawer = (
    <Box sx={{ pt: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* component="nav" makes the link list the navigation landmark — the
          copyright footer below is intentionally outside it. */}
      <List component="nav" aria-label={t('app.menu')}>
        {navItems.map((item) => {
          const button = (
            <ListItemButton
              component={Link} to={item.to} selected={item.selected}
              onClick={() => setMobileOpen(false)}
              sx={{ justifyContent: showLabels ? 'initial' : 'center', px: 2.5 }}
            >
              <ListItemIcon
                sx={{ minWidth: 0, mr: showLabels ? 3 : 'auto', justifyContent: 'center' }}
              >
                {item.icon}
              </ListItemIcon>
              {showLabels && <ListItemText primary={item.label} />}
            </ListItemButton>
          );
          // Only wrap with a Tooltip when collapsed: when expanded the visible
          // label is the accessible name, whereas a Tooltip would stamp an
          // (empty) aria-label onto the link and clobber it.
          return showLabels ? (
            <Fragment key={item.to}>{button}</Fragment>
          ) : (
            <Tooltip key={item.to} title={item.label} placement="right">
              {button}
            </Tooltip>
          );
        })}
      </List>
      {/* mt: auto pins the footer to the bottom of the flex column. */}
      <Typography
        variant="caption"
        align="center"
        sx={{ mt: 'auto', py: 2, px: 1, color: 'text.secondary' }}
      >
        {showLabels ? `© ${year} Sergio's Tech - All rights reserved` : `© ${year}`}
      </Typography>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', height: '100%' }}>
      <AppBar
        position="fixed"
        sx={{ zIndex: theme.zIndex.drawer + 1 }}
      >
        <Toolbar>
          <IconButton
            color="inherit" edge="start"
            onClick={handleNavToggle}
            sx={{ mr: 2 }}
            aria-label={
              isMobile
                ? t('app.menu')
                : collapsed
                  ? t('nav.expandSidebar')
                  : t('nav.collapseSidebar')
            }
            aria-expanded={isMobile ? mobileOpen : !collapsed}
          >
            <MenuIcon />
          </IconButton>
          <Box
            component="img"
            src={logoUrl}
            alt=""
            sx={{ height: 32, width: 'auto', mr: 1.5, display: 'block' }}
          />
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            {t('app.title')}
          </Typography>
          {/* Tenant selector: multi-client → dropdown; single client → label; 0 → nothing */}
          {clients.length > 1 && (
            <Select
              size="small"
              value={currentClientId ?? ''}
              onChange={(e) => switchClient(e.target.value)}
              aria-label={t('nav.selectClient')}
              sx={{
                color: 'inherit',
                mr: 1,
                '.MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.5)' },
                '.MuiSvgIcon-root': { color: 'inherit' },
              }}
            >
              {clients.map((c) => (
                <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
              ))}
            </Select>
          )}
          {clients.length === 1 && (
            <Typography variant="body2" sx={{ mr: 1, opacity: 0.85 }}>
              {clients[0].name}
            </Typography>
          )}
          <Select
            size="small"
            value={i18n.language.startsWith('en') ? 'en' : 'sr'}
            onChange={(e) => i18n.changeLanguage(e.target.value)}
            sx={{
              color: 'inherit',
              mr: 1,
              '.MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.5)' },
              '.MuiSvgIcon-root': { color: 'inherit' },
            }}
          >
            <MenuItem value="sr">SR</MenuItem>
            <MenuItem value="en">EN</MenuItem>
          </Select>
          <Button
            variant="outlined"
            color="inherit"
            size="small"
            onClick={logout}
            startIcon={<LogoutIcon />}
            sx={{
              display: { xs: 'none', sm: 'inline-flex' },
              textTransform: 'none',
              px: 1.5,
              borderColor: 'rgba(255,255,255,0.5)',
              '&:hover': {
                borderColor: 'rgba(255,255,255,0.85)',
                background: 'rgba(255,255,255,0.08)',
              },
            }}
          >
            {t('app.logout')}
          </Button>
          <IconButton
            color="inherit" onClick={logout}
            sx={{ display: { xs: 'inline-flex', sm: 'none' } }}
            aria-label={t('app.logout')}
          >
            <LogoutIcon />
          </IconButton>
        </Toolbar>
      </AppBar>

      <Drawer
        variant={isMobile ? 'temporary' : 'permanent'}
        open={isMobile ? mobileOpen : true}
        onClose={() => setMobileOpen(false)}
        ModalProps={{ keepMounted: true }}
        sx={{
          width: drawerWidth, flexShrink: 0,
          whiteSpace: 'nowrap',
          '& .MuiDrawer-paper': {
            width: drawerWidth, boxSizing: 'border-box', pt: 8,
            overflowX: 'hidden',
            // Only the permanent desktop drawer changes width; animating the
            // mobile temporary overlay's width would make it grow on open.
            ...(!isMobile && {
              transition: theme.transitions.create('width', {
                easing: theme.transitions.easing.sharp,
                duration: theme.transitions.duration.enteringScreen,
              }),
            }),
          },
        }}
      >
        {drawer}
      </Drawer>

      <Box component="main" sx={{ flexGrow: 1, p: { xs: 2, sm: 3 }, pt: { xs: 9, sm: 10 }, minWidth: 0 }}>
        {children}
      </Box>
    </Box>
  );
}
