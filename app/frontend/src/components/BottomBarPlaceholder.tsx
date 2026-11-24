/**
 * PLACEHOLDER for Yara's BottomBarView (R-UI-04, R-UI-05), so Gavin's views can be navigated
 * during development. Delete this file and use his once it exists.
 */
import { NavLink } from 'react-router-dom';
import { PATHS } from '../paths';

export function BottomBarPlaceholder() {
  return (
    <nav className="bottom-bar" aria-label="Main">
      <NavLink to={PATHS.home}>Home</NavLink>
      <NavLink to={PATHS.chats}>Messages</NavLink>
      <NavLink to={PATHS.profile}>Profile</NavLink>
    </nav>
  );
}
