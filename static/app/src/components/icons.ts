// ADS core icons, one deep import each so unused glyphs are tree-shaken.
// The glyph files are CommonJS; the Vite dev optimizer can hand back the module
// object instead of its default export, so each import is unwrapped once here.
// Production builds already get the component itself, and unwrapping is a no-op.
import BookWithBookmarkIconGlyph from '@atlaskit/icon/core/book-with-bookmark';
import ChangesIconGlyph from '@atlaskit/icon/core/changes';
import ClockIconGlyph from '@atlaskit/icon/core/clock';
import CrossIconGlyph from '@atlaskit/icon/core/cross';
import HomeIconGlyph from '@atlaskit/icon/core/home';
import ListBulletedIconGlyph from '@atlaskit/icon/core/list-bulleted';
import MenuIconGlyph from '@atlaskit/icon/core/menu';
import PeopleGroupIconGlyph from '@atlaskit/icon/core/people-group';
import QuestionCircleIconGlyph from '@atlaskit/icon/core/question-circle';
import SearchIconGlyph from '@atlaskit/icon/core/search';
import SettingsIconGlyph from '@atlaskit/icon/core/settings';
import SidebarCollapseIconGlyph from '@atlaskit/icon/core/sidebar-collapse';
import SidebarExpandIconGlyph from '@atlaskit/icon/core/sidebar-expand';
import ThemeIconGlyph from '@atlaskit/icon/core/theme';
import StatusErrorIconGlyph from '@atlaskit/icon/core/status-error';
import StatusInformationIconGlyph from '@atlaskit/icon/core/status-information';
import StatusSuccessIconGlyph from '@atlaskit/icon/core/status-success';
import StatusWarningIconGlyph from '@atlaskit/icon/core/status-warning';

type Glyph = typeof HomeIconGlyph;
const glyph = (m: Glyph): Glyph => (m as unknown as { default?: Glyph }).default ?? m;

export const BookWithBookmarkIcon = glyph(BookWithBookmarkIconGlyph);
export const ChangesIcon = glyph(ChangesIconGlyph);
export const ClockIcon = glyph(ClockIconGlyph);
export const CrossIcon = glyph(CrossIconGlyph);
export const HomeIcon = glyph(HomeIconGlyph);
export const ListBulletedIcon = glyph(ListBulletedIconGlyph);
export const MenuIcon = glyph(MenuIconGlyph);
export const PeopleGroupIcon = glyph(PeopleGroupIconGlyph);
export const QuestionCircleIcon = glyph(QuestionCircleIconGlyph);
export const SearchIcon = glyph(SearchIconGlyph);
export const SettingsIcon = glyph(SettingsIconGlyph);
export const SidebarCollapseIcon = glyph(SidebarCollapseIconGlyph);
export const SidebarExpandIcon = glyph(SidebarExpandIconGlyph);
export const StatusErrorIcon = glyph(StatusErrorIconGlyph);
export const StatusInformationIcon = glyph(StatusInformationIconGlyph);
export const StatusSuccessIcon = glyph(StatusSuccessIconGlyph);
export const StatusWarningIcon = glyph(StatusWarningIconGlyph);
export const ThemeIcon = glyph(ThemeIconGlyph);
