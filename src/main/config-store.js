const Store = require('electron-store');

const schema = {
    LARAVEL_API_URL:        { type: 'string',  default: 'http://localhost:8000' },
    API_KEY:                { type: 'string',  default: '' },
    ZEUSX_BASE_URL:         { type: 'string',  default: 'https://zeusx.com' },
    ZEUSX_EMAIL:            { type: 'string',  default: '' },
    ZEUSX_PASSWORD:         { type: 'string',  default: '' },
    CHROME_PATH:            { type: 'string',  default: '' },
    CHROME_PROFILE_DIR:     { type: 'string',  default: '' },
    CHROME_PROFILE_NAME:    { type: 'string',  default: '' },
    CHROME_PROFILE_EMAIL:   { type: 'string',  default: '' },
    HEADLESS:               { type: 'boolean', default: false },
    SLOW_MO:                { type: 'number',  default: 120 },
    WATCH_INTERVAL_SECONDS: { type: 'number',  default: 60 },
    startWithWindows:       { type: 'boolean', default: false },
    configured:             { type: 'boolean', default: false },
};

const store = new Store({ schema, name: 'zeusx-config' });

module.exports = {
    get:          (key)        => store.get(key),
    set:          (key, value) => store.set(key, value),
    getAll:       ()           => ({ ...store.store }),
    setAll:       (data)       => store.set(data),
    isConfigured: ()           =>
        Boolean(store.get('configured') && store.get('LARAVEL_API_URL') && store.get('API_KEY')),
};
