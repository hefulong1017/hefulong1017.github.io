x1 = 0; x2 = 1; t1 = 0; t2 = 1;
M=10;
N=10;
h = (x2-x1)/M; dt = (t2-t1)/N;
x = x1:h:x2; x = x';
t = t1:dt:t2; t = t';
u=zeros(M+1,N+1);
u(:,1)=exp(x);
u(1,:)=exp(t);
u(M+1,:)=exp(1+t);
r=dt/(h^2);
row1=zeros(M-1,1);
row1(1,1)=1+r;row1(2,1)=-r/2;
A=toeplitz(row1);
row2=zeros(M-1,1);
row2(1,1)=1-r;row2(2,1)=r/2;
B=toeplitz(row2);
H=zeros(M-1,1);
for k=1:N
H(1,1)=(r/2)*(u(1,k)+u(1,k+1));
H(M-1,1)=(r/2)*(u(M+1,k)+u(M+1,k+1));
u(2:M,k+1)=A\(B*u(2:M,k)+H);
end
F=zeros(M+1,N+1);
for i=1:M+1
    for j=1:N+1
        F(i,j)=exp(x(i)+t(j));
    end
end
error=abs(u-F);
maxerror=max(max(error));
disp(maxerror);




