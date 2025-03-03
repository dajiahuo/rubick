import { WINDOW_MAX_HEIGHT, WINDOW_MIN_HEIGHT, PRE_ITEM_HEIGHT, SYSTEM_PLUGINS } from './constans';
import path from 'path';
import fs from 'fs';
import process from 'child_process';
import Store from 'electron-store';
import downloadFile from 'download';
import { nativeImage, ipcRenderer } from 'electron';
import { APP_FINDER_PATH } from './constans';
import { getlocalDataFile } from '../../../main/common/utils';
import iconvLite from 'iconv-lite';
import bpList from 'bplist-parser';
import pinyin from 'pinyin';

const store = new Store();

function getWindowHeight(searchList) {
  if (!searchList) return WINDOW_MAX_HEIGHT;
  if (!searchList.length) return WINDOW_MIN_HEIGHT;
  return searchList.length * PRE_ITEM_HEIGHT + WINDOW_MIN_HEIGHT + 5 > WINDOW_MAX_HEIGHT
    ? WINDOW_MAX_HEIGHT
    : searchList.length * PRE_ITEM_HEIGHT + WINDOW_MIN_HEIGHT + 5;
}

function searchKeyValues(lists, value) {
  return lists.filter((item) => {
    if (typeof item === 'string') return item.indexOf(value) >= 0;
    return item.type.indexOf(value) >= 0;
  });
}

function existOrNot(path) {
  return new Promise((resolve, reject) => {
    fs.stat(path, async (err, stat) => {
      if (err) {
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

const appPath = getlocalDataFile();

async function downloadZip(downloadRepoUrl, name) {
  try {
    const plugin_path = appPath;
    // 基础模版所在目录，如果是初始化，则是模板名称，否则是项目名称
    const temp_dest = `${plugin_path}/${name}`;
    // 下载模板
    if (await existOrNot(temp_dest)) {
      await process.execSync(`rm -rf ${temp_dest}`);
    }

    await downloadFile(downloadRepoUrl, plugin_path, { extract: true });

    return temp_dest;
  } catch (e) {
    console.log(e);
  }
}

const sysFile = {
  savePlugins(plugins) {
    ipcRenderer.send('optionPlugin', {
      plugins: plugins.filter((plugin) => {
        let hasOption = false;
        plugin.features.forEach((fe) => {
          fe.cmds.forEach((cmd) => {
            if (cmd.type) {
              hasOption = true;
            }
          });
        });
        return hasOption;
      })
    });
    store.set('user-plugins', plugins);
  },
  getUserPlugins() {
    try {
      return store.get('user-plugins');
    } catch (e) {
      return [];
    }
  },
  removeAllPlugins() {
    store.delete('user-plugins');
  }
};

function mergePlugins(plugins) {
  const result = [
    ...plugins,
    ...SYSTEM_PLUGINS.map((plugin) => {
      return {
        ...plugin,
        status: true,
        sourceFile: '',
        type: 'system'
      };
    })
  ];

  const target = [];

  result.forEach((item, i) => {
    let targetIndex = -1;
    target.forEach((tg, j) => {
      if (tg.tag === item.tag && tg.type === 'system') {
        targetIndex = j;
      }
    });
    if (targetIndex === -1) {
      target.push(item);
    }
  });
  ipcRenderer &&
    ipcRenderer.send('optionPlugin', {
      plugins: target.filter((plugin) => {
        let hasOption = false;
        plugin.features.forEach((fe) => {
          fe.cmds.forEach((cmd) => {
            if (cmd.type) {
              hasOption = true;
            }
          });
        });
        return hasOption;
      })
    });

  return target;
}

function find(p, target = 'plugin.json') {
  try {
    let result;
    const fileList = fs.readdirSync(p);
    for (let i = 0; i < fileList.length; i++) {
      let thisPath = p + '/' + fileList[i];
      const data = fs.statSync(thisPath);

      if (data.isFile() && fileList[i] === target) {
        result = path.join(thisPath, '../');
        return result;
      }
      if (data.isDirectory()) {
        result = find(thisPath);
      }
    }
    return result;
  } catch (e) {
    console.log(e);
  }
}
const fileLists = [];
// 默认搜索目录
const isZhRegex = /[\u4e00-\u9fa5]/;
const getDisplayNameRegex = /\"(?:CFBundleDisplayName)\"\s\=\s\"(.*)\"/;

async function getAppZhName(rootPath, appName) {
  try {
    const ERROR_RESULT = '';
    const systemPath = path.join(rootPath, `${appName}/Contents/Resources/zh_CN.lproj/InfoPlist.strings`);
    const customizePath = path.join(rootPath, `${appName}/Contents/Resources/zh-Hans.lproj/InfoPlist.strings`);
    let appInfoPath = '';

    if (fs.existsSync(systemPath)) {
      appInfoPath = systemPath;
    } else if (fs.existsSync(customizePath)) {
      appInfoPath = customizePath;
    } else {
      return ERROR_RESULT;
    }
    let appZhName = '';
    if (rootPath == '/Applications') {
      const container = iconvLite.decode(fs.readFileSync(appInfoPath), 'utf-16');
      if (container) {
        const res = container.match(getDisplayNameRegex);
        appZhName = res && res[1];
      } else {
        return ERROR_RESULT;
      }
    } else {
      const [{ CFBundleDisplayName = '', CFBundleName = '' }] = await bpList.parseFile(appInfoPath);
      appZhName = CFBundleDisplayName || CFBundleName;
    }

    return appZhName;
  } catch (error) {
    return ERROR_RESULT;
  }
}
APP_FINDER_PATH.forEach((searchPath, index) => {
  fs.readdir(searchPath, async (err, files) => {
    try {
      for (let i = 0; i < files.length; i++) {
        const appName = files[i];
        const extname = path.extname(appName);
        const appSubStr = appName.split(extname)[0];
        if ((extname === '.app' || extname === '.prefPane') >= 0) {
          try {
            const path1 = path.join(searchPath, `${appName}/Contents/Resources/App.icns`);
            const path2 = path.join(searchPath, `${appName}/Contents/Resources/AppIcon.icns`);
            const path3 = path.join(searchPath, `${appName}/Contents/Resources/${appSubStr}.icns`);
            const path4 = path.join(searchPath, `${appName}/Contents/Resources/${appSubStr.replace(' ', '')}.icns`);
            let iconPath = path1;
            if (fs.existsSync(path1)) {
              iconPath = path1;
            } else if (fs.existsSync(path2)) {
              iconPath = path2;
            } else if (fs.existsSync(path3)) {
              iconPath = path3;
            } else if (fs.existsSync(path4)) {
              iconPath = path4;
            } else {
              // 性能最低的方式
              const resourceList = fs.readdirSync(path.join(searchPath, `${appName}/Contents/Resources`));
              const iconName = resourceList.filter((file) => path.extname(file) === '.icns')[0];
              iconPath = path.join(searchPath, `${appName}/Contents/Resources/${iconName}`);
            }
            const img = await nativeImage.createThumbnailFromPath(iconPath, { width: 64, height: 64 });

            const appZhName = await getAppZhName(searchPath, appName);

            const fileOptions = {
              value: 'plugin',
              icon: img.toDataURL(),
              desc: path.join(searchPath, appName),
              type: 'app',
              action: `open ${path.join(searchPath, appName).replace(' ', '\\ ')}`
            };

            fileLists.push({
              ...fileOptions,
              name: appSubStr,
              keyWord: appSubStr
            });

            if (appZhName && isZhRegex.test(appZhName)) {
              let cmds = [];
              const pinyinArr = pinyin(appZhName, { style: pinyin.STYLE_NORMAL });
              // pinyinArr = [['pin'], ['yin']]
              const firstLetterArr = pinyinArr.map((str) => str[0][0]);
              cmds.push(appZhName);
              cmds.push(pinyinArr.join(''));
              cmds.push(firstLetterArr.join(''));

              cmds.forEach((cmd) => {
                fileLists.push({
                  ...fileOptions,
                  name: appZhName,
                  keyWord: cmd
                });
              });
            }
          } catch (e) {}
        }
      }
    } catch (e) {
      console.log(e);
    }
  });
});

function debounce(fn, delay) {
  let timer;
  return function() {
    const context = this;
    const args = arguments;

    clearTimeout(timer);
    timer = setTimeout(function() {
      fn.apply(context, args);
    }, delay);
  };
}

export { getWindowHeight, searchKeyValues, sysFile, mergePlugins, find, downloadZip, fileLists, debounce };
