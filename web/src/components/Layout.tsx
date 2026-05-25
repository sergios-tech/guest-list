import { ReactNode, useState } from 'react';
import {
  AppBar, Toolbar, IconButton, Typography, Box, Drawer, List,
  ListItemButton, ListItemIcon, ListItemText, useMediaQuery,
  Select, MenuItem, Button,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import DashboardIcon from '@mui/icons-material/Dashboard';
import PeopleIcon from '@mui/icons-material/People';
import LogoutIcon from '@mui/icons-material/Logout';
import { useTheme } from '@mui/material/styles';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../lib/auth';

const DRAWER_WIDTH = 240;

export default function Layout({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [mobileOpen, setMobileOpen] = useState(false);
  const { t, i18n } = useTranslation();
  const { logout } = useAuth();
  const loc = useLocation();

  const drawer = (
    <Box role="navigation" sx={{ pt: 1 }}>
      <List>
        <ListItemButton
          component={Link} to="/" selected={loc.pathname === '/'}
          onClick={() => setMobileOpen(false)}
        >
          <ListItemIcon><DashboardIcon /></ListItemIcon>
          <ListItemText primary={t('nav.dashboard')} />
        </ListItemButton>
        <ListItemButton
          component={Link} to="/invitations"
          selected={loc.pathname.startsWith('/invitations')}
          onClick={() => setMobileOpen(false)}
        >
          <ListItemIcon><PeopleIcon /></ListItemIcon>
          <ListItemText primary={t('nav.invitations')} />
        </ListItemButton>
      </List>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', height: '100%' }}>
      <AppBar
        position="fixed"
        sx={{ zIndex: theme.zIndex.drawer + 1 }}
      >
        <Toolbar>
          {isMobile && (
            <IconButton
              color="inherit" edge="start"
              onClick={() => setMobileOpen((v) => !v)}
              sx={{ mr: 2 }}
              aria-label={t('app.menu')}
            >
              <MenuIcon />
            </IconButton>
          )}
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            {t('app.title')}
          </Typography>
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
          width: DRAWER_WIDTH, flexShrink: 0,
          '& .MuiDrawer-paper': {
            width: DRAWER_WIDTH, boxSizing: 'border-box', pt: 8,
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
