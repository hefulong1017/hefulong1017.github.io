function [x] = chase(A,d)
b=[0;diag(tril(A,-1),-1)];%下对角线  tril(A,-1)仅提取主对角线下方的元素。
a=diag(A);%中对角线
c=[diag(triu(A,1),1);0];%上对角线
l=zeros(size(b,1),1);%求L size(a,1)仅查询 a 的第1个维度的长度
u=zeros(size(a,1),1);%求U
n=size(a,1);%矩阵的维度
x=zeros(n,1);
y=zeros(n,1);
u(1)=a(1);
for i=2:n
    l(i)=b(i)/u(i-1);
    u(i)=a(i)-l(i)*c(i-1);
end
y(1)=d(1);
for i=2:n
    y(i)=d(i)-l(i)*y(i-1);
end
x(n)=y(n)/u(n);
for i=n-1:-1:1
    x(i)=(y(i)-c(i)*x(i+1))/u(i);
end
end

