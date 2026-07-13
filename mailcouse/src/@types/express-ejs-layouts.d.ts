declare module 'express-ejs-layouts' {
  import { RequestHandler } from 'express';
  function layouts(): RequestHandler;
  export default layouts;
}
