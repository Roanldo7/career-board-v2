import React from 'react';
import ReactDOM from 'react-dom/client';
import {ConfigProvider,App} from 'antd';
import zhCN from 'antd/locale/zh_CN';
import 'dayjs/locale/zh-cn';
import CareerApp from './App';
import './styles.css';
ReactDOM.createRoot(document.getElementById('root')!).render(<ConfigProvider button={{autoInsertSpace:false}} locale={zhCN} theme={{token:{colorPrimary:'#1677ff',borderRadius:8,fontFamily:'"Microsoft YaHei",system-ui,sans-serif'}}}><App><CareerApp/></App></ConfigProvider>);
