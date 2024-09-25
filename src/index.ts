import {WebSocket,MessageEvent} from 'ws';
import { BSON } from 'bson';
import {APIResponse, RPCNode, RPCServer, TimedCache} from "./type";

export class simple_rpc_client {
    private websocket_client: WebSocket;
    private status: boolean = false;
    private root: RPCNode = new RPCNode();
    private readonly server_cache: TimedCache<string, RPCServer>;
    private bin_first:boolean;

    get _server_cache(){
        return this.server_cache;
    }
    public constructor(ssl:boolean = false, url:string , token:string = '',bin_first:boolean = false) {
        const that:simple_rpc_client = this;
        this.server_cache = new TimedCache(
            120000,
            (key,value)=>{
                const request = new APIResponse(key,408,'Request timeout');
                const re = value.handle(request);
                if (re!=null){
                    this.send(re);
                }
            },
            60000
            );
        this.bin_first = bin_first;
        this.websocket_client = new WebSocket(encodeURI(`${ssl?"ws":"wss"}://${url}${token.length===0?`?token=${token}`:""}`));
        this.websocket_client.binaryType="arraybuffer";//使用数组类型二进制数据
        this.websocket_client.on('open',()=>{
           this.status=true;
        });
        this.websocket_client.on('error',err => {
            console.error(err);
        })
        this.websocket_client.onmessage = (event: MessageEvent) => {
            let data:APIResponse|null = null;
            if (event.data instanceof ArrayBuffer) {
                const buffer = new Uint8Array(event.data);
                data = this.handleBin(buffer);
            } else if(typeof event.data === 'string'){
                data = this.handleStr(event.data);
            }
            if (data!=null) {
                this.handle(data);
            }else{
                console.error("SimpleRPC: Data parsing failed");
            }
        };
        this.root.rpcServer = {
            handle(request: APIResponse): APIResponse | null {
                const server = that.server_cache.get(request.UUID);
                if (server===undefined){
                    return null;
                }
                that.server_cache.remove(request.UUID);
                const re = server.handle(request);
                if (re instanceof APIResponse){
                    that.send(re);
                }
                return null;
            }
        }
    }
    public close(){
        this.websocket_client.close();
    }
    public getStatus():boolean{
        return this.status;
    }
    private handleStr(message:string):APIResponse{
        const data = JSON.parse(message);
        return Object.assign(new APIResponse(),data);
    }
    private handleBin(message:Uint8Array):APIResponse{
        const data = BSON.deserialize(message);
        return Object.assign(new APIResponse(),data);
    }
    private handle(data:APIResponse){
        const key = data.key;
        if (key===''){
            this.root.rpcServer?.handle(data);
            return;
        }
        const keys=key.split('.');
        let node:RPCNode = this.root;
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            if (!node.getChildren().has(key)) {
                console.error(`SimpleRPC: No such node ${data.key}`)
                return;
            }
            node = node.getChildren().get(key)!;
        }
        const re = node.rpcServer?.handle(data);
        if (re instanceof APIResponse){
            this.send(re);
        }
    }
    public addNode(key:string='',server:RPCServer){
        if (key===''){
            console.error("SimpleRPC: key cannot be empty");
            return;
        }
        if (server===null){
            console.error("SimpleRPC: server cannot be empty");
            return;
        }
        const keys=key.split('.');
        let node:RPCNode = this.root;
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            if (!node.getChildren().has(key)) {
                node.getChildren().set(key, RPCNode.create(key));
            }
            node = node.getChildren().get(key)!;
        }
        node.rpcServer = server;
    }
    public removeNode(key:string = ""){
        if (key===''){
            console.error("SimpleRPC: key cannot be empty");
            return;
        }
        const keys=key.split('.');
        let lastNode = this.root;
        let node = this.root;
        let nowKey = '';
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            nowKey = key;
            lastNode = node;
            if (!node.getChildren().has(key)) {
                return;
            }
            node = node.getChildren().get(key)!;
        }
        lastNode.getChildren().delete(nowKey);
    }
    public addSendCallBack(uuid:string,server:RPCServer):void{
        this.server_cache.set(uuid,server);
    }
    public send(message:APIResponse,useBin:boolean=this.bin_first):void{
        if (this.websocket_client.OPEN){
            if (useBin){
                this.websocket_client.send(message.toBsonBin());
            }else{
                this.websocket_client.send(message.toJsonStr());
            }
        }
    }
    public sendAndCallBack(message:APIResponse,useBin:boolean=this.bin_first,server:RPCServer){
        this.addSendCallBack(message.UUID,server);
        this.send(message,useBin);
    }

}