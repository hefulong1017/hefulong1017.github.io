for ii=5:8
M=10*(2^(ii-1));
xa=0;xb=pi;
h=(xb-xa)/M;
x=xa:h:xb;x=x';
u=zeros(M+1,1);
F1 =@(x) exp(x).*(sin(x)-2*cos(x));
row1=zeros(M+1,1);

row1(1,1)=2+h^2;row1(2,1)=-1;
A=toeplitz(row1);
H=zeros(M+1,1);
H(1) = 0;
H(M+1) = 0;
H(2:M,1) = h^2*F1(x(2:M));
u=A\H;
F=zeros(M,1);
for j=1:M+1
    F(j)=exp(x(j))*sin(x(j));
end
error=abs(u-F);
MaxErr(ii) = max((error));
disp(['最大误差: ', num2str(MaxErr(ii))]);
figure(1)
plot(x,u,'^')
hold on
figure(2)
plot(x,error,'--')
hold on
end
for j=5:7
    ord=MaxErr(j)/MaxErr(j+1);
    disp(ord)
end