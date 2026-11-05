// Inherited compare/segment from PS-LAB-04 resolve.cjs; static checks only.
// No APT selection, backtracking, transaction ordering or full Multi-Arch.
function segment(a,b){let i=0,j=0;const digit=c=>c!==undefined&&/[0-9]/.test(c);const order=c=>c==='~'?-1:c===undefined||digit(c)?0:/[A-Za-z]/.test(c)?c.charCodeAt(0):c.charCodeAt(0)+256;while(i<a.length||j<b.length){while((i<a.length&&!digit(a[i]))||(j<b.length&&!digit(b[j]))){const d=order(a[i])-order(b[j]);if(d)return Math.sign(d);if(i<a.length)i++;if(j<b.length)j++;}while(a[i]==='0')i++;while(b[j]==='0')j++;let x=i,y=j;while(digit(a[i]))i++;while(digit(b[j]))j++;if(i-x!==j-y)return Math.sign((i-x)-(j-y));const aa=a.slice(x,i),bb=b.slice(y,j);if(aa!==bb)return aa<bb?-1:1;}return 0;}
function compare(a,b){const split=v=>{const m=/^(?:(\d+):)?(.*)$/.exec(v),p=m[2].lastIndexOf('-');return [Number(m[1]||0),p<0?m[2]:m[2].slice(0,p),p<0?'0':m[2].slice(p+1)];};const x=split(a),y=split(b);return Math.sign(x[0]-y[0])||segment(x[1],y[1])||segment(x[2],y[2]);}

module.exports = { compare };
