/**
 * Jest setup file for Joplin expense plugin tests
 */

// Mock Joplin API since it's not available in test environment
const mockJoplin = {
  data: {
    get: jest.fn(),
    put: jest.fn(),
  },
  settings: {
    value: jest.fn(),
    setValue: jest.fn(),
    registerSection: jest.fn(),
    registerSettings: jest.fn(),
  },
  commands: {
    register: jest.fn(),
    execute: jest.fn(),
  },
  views: {
    dialogs: {
      create: jest.fn(),
      setHtml: jest.fn(),
      setButtons: jest.fn(),
      open: jest.fn(),
      showMessageBox: jest.fn(),
    },
    menuItems: {
      create: jest.fn(),
    },
  },
  workspace: {
    selectedNote: jest.fn(),
    onNoteChange: jest.fn(),
  },
  contentScripts: {
    register: jest.fn(),
    onMessage: jest.fn(),
  },
  plugins: {
    register: jest.fn(),
  },
};

// Mock the Joplin API module
jest.mock('api', () => ({
  __esModule: true,
  default: mockJoplin,
}));

// Mock API types
jest.mock('api/types', () => ({
  MenuItemLocation: {
    Tools: 'tools',
    EditorContextMenu: 'editorContextMenu',
  },
  ContentScriptType: {
    CodeMirrorPlugin: 'codeMirrorPlugin',
  },
  SettingItemType: {
    String: 1,
    Int: 2,
    Bool: 3,
  },
}));

// Global test utilities
(global as any).mockJoplin = mockJoplin;

// Clear all mocks before each test
beforeEach(() => {
  jest.clearAllMocks();
});